# T13 验收记录：常用钢材与型钢库

## 首批条目与来源

| 类别 | 条目 | 来源版本 | 字段与单位 |
| --- | --- | --- | --- |
| 材料 | S235JR、S275JR、S355JR | EN 10025-2:2019 | E (GPa)、ν、ρ (kg/m³) |
| 型钢 | IPE 100、IPE 200、HEA 200 | ArcelorMittal Sections and Merchant Bars V2026-1，EN sections sheet | A (m²)、Iy/Iz/It (m⁴) |

来源 URL、核对日期和单位说明随每个项目资源保存，见 `src/domain/resource-library.ts`。型钢表头明确为 `A (cm²)`、`Iy (cm⁴)`、`Iz (cm⁴)` 和 `It (cm⁴)`；代码将 IPE 100、IPE 200、HEA 200 的抽样行转换为 SI 单位，并把 `It` 作为 Saint-Venant 扭转常数保存，没有把相近名称的截面模量或塑性模量替换为惯性矩。

## 自动化核对

- `src/domain/resource-library.test.ts` 核对首批编号、来源元数据、参数复制、项目保存重开、库条目编辑后的派生来源和杆件引用。
- `npm run typecheck` 通过。
- `npm test`：17 个测试文件、98 个测试通过。
- `npm run build` 通过。
- `e2e/t13-resource-library.spec.ts`：目录选择、来源展示、字段含义、派生自定义参数和项目保存通过。
- `npm run test:e2e`：26 个 Electron/Playwright 用例全部通过。

## 交互验收路径

1. 点击“材料与截面”，在“材料库”和“截面库”选择条目；参数字段显示载入值和来源链接。
2. 保存后，从项目树选择材料或截面；属性面板显示库编号、发布版本、单位及核对日期。
3. 修改任一字段并保存；属性面板将来源标为“自定义参数（由库条目修改）”，同时保留原库编号和来源。
4. 保存并重开项目；实际参数和来源元数据保持不变，后续杆件继续引用同一稳定 ID。
