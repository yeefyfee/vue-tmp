import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { OnlineUserDto } from "../auth/interfaces/user-session.interface";

interface SessionInfo {
  username: string;
  connectTime: number;
  /** 会话所属租户（JWT 携带；平台账号为 null）——用于租户级定向广播 */
  tenantId: string | null;
}

@Injectable()
export class SseSessionRegistry implements OnModuleDestroy {
  private readonly userEmittersMap: Map<string, Set<any>> = new Map();
  private readonly emitterUserMap: Map<any, SessionInfo> = new Map();

  userConnected(username: string, emitter: any, tenantId: string | null = null): void {
    if (!this.userEmittersMap.has(username)) {
      this.userEmittersMap.set(username, new Set());
    }
    this.userEmittersMap.get(username)!.add(emitter);
    this.emitterUserMap.set(emitter, {
      username,
      connectTime: Date.now(),
      tenantId: tenantId ?? null,
    });
  }

  userDisconnected(username: string): void {
    const emitters = this.userEmittersMap.get(username);
    if (emitters) {
      emitters.forEach((emitter) => {
        this.emitterUserMap.delete(emitter);
      });
    }
    this.userEmittersMap.delete(username);
  }

  removeEmitter(emitter: any): void {
    const sessionInfo = this.emitterUserMap.get(emitter);
    if (!sessionInfo) {
      return;
    }

    this.emitterUserMap.delete(emitter);
    const emitters = this.userEmittersMap.get(sessionInfo.username);
    if (emitters) {
      emitters.delete(emitter);
      if (emitters.size === 0) {
        this.userEmittersMap.delete(sessionInfo.username);
      }
    }
  }

  getOnlineUserCount(): number {
    return this.userEmittersMap.size;
  }

  getTotalConnectionCount(): number {
    return this.emitterUserMap.size;
  }

  isUserOnline(username: string): boolean {
    const emitters = this.userEmittersMap.get(username);
    return emitters !== undefined && emitters.size > 0;
  }

  getOnlineUsers(): OnlineUserDto[] {
    const result: OnlineUserDto[] = [];
    this.userEmittersMap.forEach((emitters, username) => {
      let earliestLoginTime = Infinity;
      emitters.forEach((emitter) => {
        const sessionInfo = this.emitterUserMap.get(emitter);
        if (sessionInfo && sessionInfo.connectTime < earliestLoginTime) {
          earliestLoginTime = sessionInfo.connectTime;
        }
      });

      result.push({
        username,
        sessionCount: emitters.size,
        loginTime: earliestLoginTime === Infinity ? Date.now() : earliestLoginTime,
      });
    });
    return result;
  }

  getAllEmitters(): Set<any> {
    return new Set(this.emitterUserMap.keys());
  }

  getUserEmitters(username: string): Set<any> | undefined {
    return this.userEmittersMap.get(username);
  }

  /**
   * 取某租户下所有活跃连接的 emitter（租户级定向广播）
   *
   * 会话的租户归属在连接建立时由 JWT 写入（见 `userConnected`）。租户值为空
   * （平台账号 / 未携带）时返回空集——**不做全局兜底**，避免把事件误广播到其他租户。
   */
  getEmittersByTenant(tenantId: string | null | undefined): Set<any> {
    const result = new Set<any>();
    if (tenantId === null || tenantId === undefined || tenantId === "") {
      return result;
    }
    const target = String(tenantId);
    this.emitterUserMap.forEach((sessionInfo, emitter) => {
      if (sessionInfo.tenantId === target) {
        result.add(emitter);
      }
    });
    return result;
  }

  onModuleDestroy() {
    // 主动关闭所有 SSE 连接的 HTTP 响应
    this.emitterUserMap.forEach((sessionInfo, emitter) => {
      try {
        if (emitter.complete) {
          emitter.complete();
        }
      } catch {
        // 单个 SSE 连接关闭异常不影响其余会话清理
      }
    });
    this.userEmittersMap.clear();
    this.emitterUserMap.clear();
  }
}
