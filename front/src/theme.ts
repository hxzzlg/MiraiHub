import { theme } from 'antd'
import type { ThemeMode } from './context/ThemeContext'

/** 品牌科技浅蓝 */
export const BRAND = '#2E9BFF'

export function makeTheme(mode: ThemeMode): import('antd').ThemeConfig {
  return {
    algorithm: mode === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: {
      colorPrimary: BRAND,
      borderRadius: 8,
      fontSize: 13.5,
    },
    components: {
      Layout: {
        headerHeight: 48,
        headerPadding: '0 16px',
        // 顶栏跟随主题背景（antd 默认深色 headerBg 在浅色模式下突兀难读）
        headerBg: mode === 'dark' ? '#11161d' : '#ffffff',
        headerColor: mode === 'dark' ? 'rgba(255,255,255,0.86)' : 'rgba(0,0,0,0.88)',
        siderBg: mode === 'dark' ? '#11161d' : '#ffffff',
      },
      Table: {
        cellPaddingBlockSM: 6,
        cellPaddingInlineSM: 10,
      },
      Menu: {
        itemHeight: 34,
      },
    },
  }
}
