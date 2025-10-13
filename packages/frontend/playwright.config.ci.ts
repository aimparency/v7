import baseConfig from './playwright.config'

export default {
  ...baseConfig,
  reporter: 'list',
  use: {
    ...baseConfig.use,
    headless: true,
  },
}