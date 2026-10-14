import { Injectable, Logger } from "@nestjs/common";
import { SseSessionRegistry } from "./sse-session-registry.service";
import { Observable, Subject } from "rxjs";

export const SSE_TOPICS = {
  DICT: "dict",
  ONLINE_COUNT: "online-count",
  SYSTEM: "system",
  /** 工作台变更（房态 / 健康档案等影响工作台读数的写入）——租户级定向推送 */
  DASHBOARD: "dashboard",
} as const;

interface DictChangeEvent {
  dictCode: string;
  timestamp: number;
}

/**
 * 工作台变更事件载荷（MVP-WEB-03-02）
 *
 * 🔴 **不含业务数据**：仅作「现在该刷新了」的信号，客户端收到后携带自身令牌
 * 重新拉取 `GET /dashboard/overview`（服务端再按租户/门店作用域鉴权取数）。
 * 这样即使报文被截获也不泄露任何跨租户业务读数。
 */
export interface DashboardChangeEvent {
  /** 触发原因（便于前端调试 / 埋点，不参与渲染） */
  reason: string;
  /** 触发门店（未切店上下文时为 null） */
  storeId: string | null;
  timestamp: number;
}

@Injectable()
export class SseService {
  private readonly logger = new Logger(SseService.name);
  private readonly eventSubject = new Subject<{
    eventName: string;
    data: any;
    username?: string;
  }>();

  constructor(private readonly sessionRegistry: SseSessionRegistry) {}

  createConnection(username: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      const emitter = {
        send: (eventName: string, data: any) => {
          subscriber.next({ data: JSON.stringify({ eventName, data }) } as MessageEvent);
        },
        complete: () => {
          subscriber.complete();
        },
      };

      this.sessionRegistry.userConnected(username, emitter as any);
      this.logger.debug(`SSE connection established: username=${username}`);

      // 发送初始在线人数
      this.sendOnlineCount();

      return () => {
        this.sessionRegistry.removeEmitter(emitter as any);
        this.logger.debug(`SSE connection closed: username=${username}`);
        this.sendOnlineCount();
      };
    });
  }

  sendDictChange(dictCode: string): void {
    const event: DictChangeEvent = {
      dictCode,
      timestamp: Date.now(),
    };
    this.broadcast(SSE_TOPICS.DICT, event);
    this.logger.debug(`Dict change event sent: dictCode=${dictCode}`);
  }

  sendOnlineCount(): void {
    const count = this.sessionRegistry.getOnlineUserCount();
    this.broadcast(SSE_TOPICS.ONLINE_COUNT, count);
  }

  /**
   * 推送工作台变更信号（MVP-WEB-03-02）——**租户级定向**，不跨租户广播
   *
   * 房态切换、健康档案写入等会改变工作台读数的写操作，在事务成功后调用本方法；
   * 同一租户下的所有在线会话（含多标签页）即时收到 `dashboard` 事件并触发增量刷新，
   * 实现 PRD《数据刷新策略》「关键状态变化即时刷新，不整页重载」。
   *
   * 租户缺失时不广播（fail-closed）：宁可漏发一次推送（下次 60s 轮询自然补齐），
   * 也绝不把事件发到其他租户。
   */
  sendDashboardChange(
    tenantId: string | null | undefined,
    reason: string,
    storeId?: string | null
  ): void {
    const emitters = this.sessionRegistry.getEmittersByTenant(tenantId);
    if (emitters.size === 0) {
      return;
    }
    const event: DashboardChangeEvent = {
      reason,
      storeId: storeId ?? null,
      timestamp: Date.now(),
    };
    emitters.forEach((emitter: any) => {
      try {
        emitter.send(SSE_TOPICS.DASHBOARD, event);
      } catch {
        this.sessionRegistry.removeEmitter(emitter);
      }
    });
    this.logger.debug(`Dashboard change sent: tenant=${tenantId} reason=${reason}`);
  }

  sendToUser(username: string, eventName: string, data: any): void {
    const emitters = this.sessionRegistry.getUserEmitters(username);
    if (emitters) {
      emitters.forEach((emitter: any) => {
        try {
          emitter.send(eventName, data);
        } catch {
          this.logger.warn(`Failed to send event to user: ${username}`);
          this.sessionRegistry.removeEmitter(emitter);
        }
      });
    }
    this.logger.debug(`Event sent to user: username=${username} event=${eventName}`);
  }

  getOnlineUsers() {
    return this.sessionRegistry.getOnlineUsers();
  }

  getOnlineUserCount(): number {
    return this.sessionRegistry.getOnlineUserCount();
  }

  sendSystemMessage(message: string): void {
    const systemMessage = {
      sender: "系统通知",
      content: message,
      timestamp: Date.now(),
    };
    this.broadcast(SSE_TOPICS.SYSTEM, systemMessage);
    this.logger.debug(`System message sent: ${message}`);
  }

  private broadcast(eventName: string, data: any): void {
    const emitters = this.sessionRegistry.getAllEmitters();
    emitters.forEach((emitter: any) => {
      try {
        emitter.send(eventName, data);
      } catch {
        this.sessionRegistry.removeEmitter(emitter);
      }
    });
  }
}
