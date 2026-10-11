import { mergeReportSidebarRoots } from './mergeReportSidebarRoots';

test('merges legacy report children into the existing Reports section', () => {
  const menus = [
    { menuId: 79, menuName: 'Reports', menuPath: '', children: [
      { menuId: 80, menuName: 'Report Layout Manager', menuPath: '/reportlayoutmanager', children: [] },
      { menuId: 90, menuName: 'Financial', menuPath: '', children: [
        { menuId: 91, menuName: 'Balance Sheet', menuPath: '/reports/financial/balance-sheet', children: [] },
      ] },
    ] },
    { menuId: 142, menuName: 'Reports', menuPath: '/reports', children: [
      { menuId: 174, menuName: 'Financial', menuPath: '', children: [
        { menuId: 175, menuName: 'Custom Report', menuPath: '/reportlayoutmanager/menu/19', children: [] },
      ] },
    ] },
    { menuId: 237, menuName: 'Company Reports', menuPath: '/reports/company', children: [] },
  ];

  const result = mergeReportSidebarRoots(menus);

  expect(result.map((menu) => menu.menuId)).toEqual([79, 237]);
  expect(result[0].children.map((menu) => menu.menuId)).toEqual([80, 90]);
  expect(result[0].children[1].children.map((menu) => menu.menuId)).toEqual([91, 175]);
  expect(menus[0].children[1].children).toHaveLength(1);
});

test('uses the legacy Reports entry as a section when it is the only authorized root', () => {
  const result = mergeReportSidebarRoots([
    { menuId: 142, menuName: 'Reports', menuPath: '/reports', children: [
      { menuId: 194, menuName: 'Business Partners', menuPath: '/reportlayoutmanager/menu/19', children: [] },
    ] },
  ]);

  expect(result).toHaveLength(1);
  expect(result[0].menuPath).toBe('');
  expect(result[0].children[0].menuId).toBe(194);
});
