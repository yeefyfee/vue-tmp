import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_spacing.dart';
import '../../../../core/utils/formatters.dart';
import '../../../../shared/widgets/app_scaffold.dart';
import '../../../../shared/widgets/async_view.dart';
import '../../data/models/storage_category.dart';
import '../../providers/storage_provider.dart';
import '../widgets/item_card.dart';

/// 物品新增 / 编辑表单
///
/// [itemId] 为空表示新增；否则为编辑模式，进入后拉取详情回填。
class ItemFormPage extends ConsumerStatefulWidget {
  const ItemFormPage({super.key, this.itemId});

  final String? itemId;

  @override
  ConsumerState<ItemFormPage> createState() => _ItemFormPageState();
}

class _ItemFormPageState extends ConsumerState<ItemFormPage> {
  final _formKey = GlobalKey<FormState>();

  final _nameCtrl = TextEditingController();
  final _quantityCtrl = TextEditingController(text: '1');
  final _unitCtrl = TextEditingController();
  final _priceCtrl = TextEditingController();
  final _locationCtrl = TextEditingController();
  final _remarkCtrl = TextEditingController();

  String? _categoryId;
  List<String> _tagIds = [];
  DateTime? _purchaseDate;
  DateTime? _expireDate;
  String? _coverUrl;
  List<String> _imageUrls = [];

  bool _saving = false;
  bool _uploading = false;
  bool _initialized = false;

  bool get _isEdit => widget.itemId != null;

  @override
  void initState() {
    super.initState();
    if (_isEdit) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _loadDetail());
    } else {
      _initialized = true;
    }
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _quantityCtrl.dispose();
    _unitCtrl.dispose();
    _priceCtrl.dispose();
    _locationCtrl.dispose();
    _remarkCtrl.dispose();
    super.dispose();
  }

  /// 编辑模式：拉取详情并回填表单
  Future<void> _loadDetail() async {
    try {
      final item = await ref.read(storageRepositoryProvider).fetchItemDetail(widget.itemId!);
      if (!mounted) return;

      setState(() {
        _nameCtrl.text = item.name;
        _quantityCtrl.text = item.quantity.toString();
        _unitCtrl.text = item.unit ?? '';
        _priceCtrl.text = item.price?.toString() ?? '';
        _locationCtrl.text = item.location ?? '';
        _remarkCtrl.text = item.remark ?? '';
        _categoryId = item.categoryId;
        _tagIds = item.tags.map((t) => t.id).toList();
        _purchaseDate = item.purchaseDate;
        _expireDate = item.expireDate;
        _coverUrl = item.coverUrl;
        _imageUrls = List.of(item.imageUrls);
        _initialized = true;
      });
    } catch (e) {
      if (!mounted) return;
      _toast(e.toString(), isError: true);
      setState(() => _initialized = true);
    }
  }

  /// 选择并上传图片
  Future<void> _pickImage({bool asCover = false}) async {
    try {
      final picker = ImagePicker();
      final file = await picker.pickImage(source: ImageSource.gallery, imageQuality: 82);
      if (file == null) return;

      setState(() => _uploading = true);

      final url = await ref.read(storageRepositoryProvider).uploadImage(
            filePath: file.path,
            fileName: file.name,
          );

      if (!mounted) return;
      setState(() {
        if (asCover || _coverUrl == null) {
          _coverUrl = url;
        }
        if (!_imageUrls.contains(url)) _imageUrls.add(url);
        _uploading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _uploading = false);
      _toast(e.toString(), isError: true);
    }
  }

  Future<void> _pickDate({required bool isPurchase}) async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: (isPurchase ? _purchaseDate : _expireDate) ?? now,
      firstDate: DateTime(2000),
      lastDate: DateTime(now.year + 20),
    );

    if (picked == null) return;
    setState(() {
      if (isPurchase) {
        _purchaseDate = picked;
      } else {
        _expireDate = picked;
      }
    });
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() => _saving = true);

    final payload = <String, dynamic>{
      'name': _nameCtrl.text.trim(),
      'categoryId': _categoryId,
      'quantity': int.tryParse(_quantityCtrl.text.trim()) ?? 1,
      'unit': _unitCtrl.text.trim(),
      'location': _locationCtrl.text.trim(),
      'remark': _remarkCtrl.text.trim(),
      'tagIds': _tagIds,
      'coverUrl': _coverUrl,
      'imageUrls': _imageUrls,
      if (_priceCtrl.text.trim().isNotEmpty)
        'price': double.tryParse(_priceCtrl.text.trim()),
      if (_purchaseDate != null) 'purchaseDate': Formatters.toApiDate(_purchaseDate!),
      if (_expireDate != null) 'expireDate': Formatters.toApiDate(_expireDate!),
    };

    try {
      final repo = ref.read(storageRepositoryProvider);
      if (_isEdit) {
        await repo.updateItem(widget.itemId!, payload);
      } else {
        await repo.createItem(payload);
      }

      if (!mounted) return;

      // 刷新列表与概览
      ref.invalidate(storageOverviewProvider);
      ref.invalidate(itemDetailProvider(widget.itemId ?? ''));
      ref.read(itemListControllerProvider.notifier).load();

      _toast(_isEdit ? '已保存' : '添加成功');
      context.pop();
    } catch (e) {
      if (!mounted) return;
      setState(() => _saving = false);
      _toast(e.toString(), isError: true);
    }
  }

  void _toast(String message, {bool isError = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message),
          backgroundColor: isError ? AppColors.danger : null,
        ),
      );
  }

  @override
  Widget build(BuildContext context) {
    if (!_initialized) {
      return const AppScaffold(title: '编辑物品', body: LoadingView());
    }

    final categoriesAsync = ref.watch(categoryOptionsProvider);
    final tagsAsync = ref.watch(tagListProvider);

    return AppScaffold(
      title: _isEdit ? '编辑物品' : '添加物品',
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(AppSpacing.pagePadding),
          children: [
            // --- 图片 -------------------------------------------------------
            const _SectionTitle('物品图片'),
            _buildImagePicker(),
            const SizedBox(height: AppSpacing.xl),

            // --- 基础信息 ---------------------------------------------------
            const _SectionTitle('基础信息'),
            AppCard(
              padding: const EdgeInsets.all(AppSpacing.lg),
              child: Column(
                children: [
                  TextFormField(
                    controller: _nameCtrl,
                    decoration: const InputDecoration(
                      labelText: '物品名称 *',
                      hintText: '如：机械键盘',
                    ),
                    validator: (v) =>
                        (v == null || v.trim().isEmpty) ? '请输入物品名称' : null,
                  ),
                  const SizedBox(height: AppSpacing.md),

                  // 分类选择
                  categoriesAsync.when(
                    loading: () => const _FieldPlaceholder(),
                    error: (_, __) => const _FieldPlaceholder(text: '分类加载失败'),
                    data: (categories) => _CategorySelector(
                      categories: categories,
                      selectedId: _categoryId,
                      onChanged: (id) => setState(() => _categoryId = id),
                    ),
                  ),
                  const SizedBox(height: AppSpacing.md),

                  Row(
                    children: [
                      Expanded(
                        child: TextFormField(
                          controller: _quantityCtrl,
                          keyboardType: TextInputType.number,
                          decoration: const InputDecoration(labelText: '数量'),
                        ),
                      ),
                      const SizedBox(width: AppSpacing.md),
                      Expanded(
                        child: TextFormField(
                          controller: _unitCtrl,
                          decoration: const InputDecoration(
                            labelText: '单位',
                            hintText: '个 / 件 / 盒',
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.md),

                  TextFormField(
                    controller: _priceCtrl,
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    decoration: const InputDecoration(
                      labelText: '单价',
                      prefixText: '¥ ',
                      hintText: '选填',
                    ),
                  ),
                  const SizedBox(height: AppSpacing.md),

                  TextFormField(
                    controller: _locationCtrl,
                    decoration: const InputDecoration(
                      labelText: '存放位置',
                      hintText: '如：书房抽屉第二层',
                      prefixIcon: Icon(Icons.place_outlined, size: 18),
                    ),
                  ),
                ],
              ),
            ),

            const SizedBox(height: AppSpacing.xl),

            // --- 标签 -------------------------------------------------------
            const _SectionTitle('标签'),
            AppCard(
              padding: const EdgeInsets.all(AppSpacing.lg),
              child: tagsAsync.when(
                loading: () => const _FieldPlaceholder(),
                error: (_, __) => const _FieldPlaceholder(text: '标签加载失败'),
                data: (tags) {
                  if (tags.isEmpty) {
                    return const Text(
                      '还没有标签，可在「标签管理」中创建',
                      style: TextStyle(fontSize: 13, color: AppColors.textTertiary),
                    );
                  }
                  return Wrap(
                    spacing: AppSpacing.sm,
                    runSpacing: AppSpacing.sm,
                    children: tags.map((tag) {
                      final selected = _tagIds.contains(tag.id);
                      return GestureDetector(
                        onTap: () => setState(() {
                          if (selected) {
                            _tagIds.remove(tag.id);
                          } else {
                            _tagIds.add(tag.id);
                          }
                        }),
                        child: ColorTag(
                          label: tag.name,
                          color: parseHexColor(tag.color),
                          dense: !selected,
                          icon: selected ? Icons.check : null,
                        ),
                      );
                    }).toList(),
                  );
                },
              ),
            ),

            const SizedBox(height: AppSpacing.xl),

            // --- 日期 -------------------------------------------------------
            const _SectionTitle('日期'),
            AppCard(
              padding: EdgeInsets.zero,
              child: Column(
                children: [
                  _DateTile(
                    label: '购置日期',
                    value: _purchaseDate,
                    onTap: () => _pickDate(isPurchase: true),
                    onClear: () => setState(() => _purchaseDate = null),
                  ),
                  const Divider(height: 0.5, indent: AppSpacing.lg),
                  _DateTile(
                    label: '过期日期',
                    value: _expireDate,
                    onTap: () => _pickDate(isPurchase: false),
                    onClear: () => setState(() => _expireDate = null),
                  ),
                ],
              ),
            ),

            const SizedBox(height: AppSpacing.xl),

            // --- 备注 -------------------------------------------------------
            const _SectionTitle('备注'),
            AppCard(
              padding: const EdgeInsets.all(AppSpacing.lg),
              child: TextFormField(
                controller: _remarkCtrl,
                maxLines: 3,
                decoration: const InputDecoration(
                  hintText: '补充说明（选填）',
                  border: InputBorder.none,
                  enabledBorder: InputBorder.none,
                  focusedBorder: InputBorder.none,
                  filled: false,
                ),
              ),
            ),

            const SizedBox(height: AppSpacing.xxl),

            // --- 保存 -------------------------------------------------------
            ElevatedButton(
              onPressed: (_saving || _uploading) ? null : _save,
              child: _saving
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                    )
                  : Text(_isEdit ? '保存修改' : '添加物品'),
            ),

            const SizedBox(height: AppSpacing.xl),
          ],
        ),
      ),
    );
  }

  /// 图片选择区
  Widget _buildImagePicker() {
    return AppCard(
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Wrap(
        spacing: AppSpacing.sm,
        runSpacing: AppSpacing.sm,
        children: [
          // 已上传图片
          for (final url in _imageUrls)
            Stack(
              children: [
                ClipRRect(
                  borderRadius: BorderRadius.circular(AppRadius.sm),
                  child: Image.network(
                    url,
                    width: 76,
                    height: 76,
                    fit: BoxFit.cover,
                    errorBuilder: (_, __, ___) => Container(
                      width: 76,
                      height: 76,
                      color: AppColors.primaryLight,
                      child: const Icon(Icons.broken_image_outlined, size: 20),
                    ),
                  ),
                ),
                if (_coverUrl == url)
                  Positioned(
                    left: 2,
                    bottom: 2,
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
                      decoration: BoxDecoration(
                        color: AppColors.primary,
                        borderRadius: BorderRadius.circular(AppRadius.xs),
                      ),
                      child: const Text(
                        '封面',
                        style: TextStyle(fontSize: 9, color: Colors.white),
                      ),
                    ),
                  ),
                Positioned(
                  right: -6,
                  top: -6,
                  child: IconButton(
                    iconSize: 16,
                    visualDensity: VisualDensity.compact,
                    icon: const Icon(Icons.cancel, color: AppColors.textTertiary),
                    onPressed: () => setState(() {
                      _imageUrls.remove(url);
                      if (_coverUrl == url) {
                        _coverUrl = _imageUrls.isEmpty ? null : _imageUrls.first;
                      }
                    }),
                  ),
                ),
              ],
            ),

          // 添加按钮
          GestureDetector(
            onTap: _uploading ? null : () => _pickImage(),
            child: Container(
              width: 76,
              height: 76,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: Theme.of(context).inputDecorationTheme.fillColor,
                borderRadius: BorderRadius.circular(AppRadius.sm),
                border: Border.all(color: AppColors.divider),
              ),
              child: _uploading
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.add_photo_alternate_outlined,
                            size: 22, color: AppColors.textTertiary),
                        SizedBox(height: 2),
                        Text(
                          '添加图片',
                          style: TextStyle(fontSize: 10, color: AppColors.textTertiary),
                        ),
                      ],
                    ),
            ),
          ),
        ],
      ),
    );
  }
}

// -----------------------------------------------------------------------------
// 局部组件
// -----------------------------------------------------------------------------

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.title);
  final String title;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.md),
      child: Text(
        title,
        style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
      ),
    );
  }
}

class _FieldPlaceholder extends StatelessWidget {
  const _FieldPlaceholder({this.text});
  final String? text;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 48,
      alignment: Alignment.centerLeft,
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
      decoration: BoxDecoration(
        color: Theme.of(context).inputDecorationTheme.fillColor,
        borderRadius: BorderRadius.circular(AppRadius.sm),
      ),
      child: Text(
        text ?? '加载中…',
        style: const TextStyle(fontSize: 14, color: AppColors.textTertiary),
      ),
    );
  }
}

/// 分类选择器（下拉 + 快速清除）
class _CategorySelector extends StatelessWidget {
  const _CategorySelector({
    required this.categories,
    required this.selectedId,
    required this.onChanged,
  });

  final List<StorageCategory> categories;
  final String? selectedId;
  final ValueChanged<String?> onChanged;

  @override
  Widget build(BuildContext context) {
    return DropdownButtonFormField<String?>(
      initialValue: selectedId,
      isExpanded: true,
      decoration: const InputDecoration(
        labelText: '所属分类',
        prefixIcon: Icon(Icons.folder_outlined, size: 18),
      ),
      hint: const Text('选择分类'),
      items: [
        const DropdownMenuItem<String?>(value: null, child: Text('未分类')),
        ...categories.map(
          (c) => DropdownMenuItem<String?>(
            value: c.id,
            child: Text(c.name, overflow: TextOverflow.ellipsis),
          ),
        ),
      ],
      onChanged: onChanged,
    );
  }
}

/// 日期选择行
class _DateTile extends StatelessWidget {
  const _DateTile({
    required this.label,
    required this.value,
    required this.onTap,
    required this.onClear,
  });

  final String label;
  final DateTime? value;
  final VoidCallback onTap;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.lg,
          vertical: AppSpacing.md,
        ),
        child: Row(
          children: [
            const Icon(Icons.calendar_today_outlined,
                size: 18, color: AppColors.textSecondary),
            const SizedBox(width: AppSpacing.md),
            Text(label, style: const TextStyle(fontSize: 14)),
            const Spacer(),
            Text(
              value == null ? '未设置' : Formatters.date(value),
              style: TextStyle(
                fontSize: 14,
                color: value == null ? AppColors.textTertiary : null,
              ),
            ),
            if (value != null) ...[
              const SizedBox(width: AppSpacing.xs),
              GestureDetector(
                onTap: onClear,
                child: const Icon(Icons.clear, size: 16, color: AppColors.textTertiary),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
