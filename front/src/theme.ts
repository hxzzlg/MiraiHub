import { theme } from 'antd'
import type { ThemeMode } from './context/ThemeContext'

/** 品牌正蓝（与旧版设计令牌一致） */
export const BRAND = '#4176e6'

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
