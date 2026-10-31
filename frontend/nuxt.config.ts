import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',

  // 純前端（SPA）：可直接放 GitHub Pages／Vercel 靜態網站；token 存 localStorage（PRD §19）
  ssr: false,

  css: ['~/assets/css/main.css'],

  vite: {
    plugins: [tailwindcss()],
  },

  app: {
    // GitHub Pages 部署時用環境變數 NUXT_APP_BASE_URL=/frontend-moneymate-demo/（建置時就要讀到，不能寫死）
    baseURL: process.env.NUXT_APP_BASE_URL || '/',
    head: {
      title: 'Money Mate',
      htmlAttrs: { lang: 'zh-Hant-TW' },
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cut' },
        { name: 'description', content: 'Money Mate：記帳＋理財＋懶人友善' },
        { name: 'theme-color', content: '#0f766e' },
      ],
      link: [{ rel: 'icon', type: 'image/svg+xml', href: `${process.env.NUXT_APP_BASE_URL ?? '/'}favicon.svg` }],
    },
  },

  runtimeConfig: {
    public: {
      // 'mock'：瀏覽器內假後端（現在）；'http'：連 NestJS 後端（之後）
      // 部署時用 NUXT_PUBLIC_API_MODE、NUXT_PUBLIC_API_BASE 覆蓋
      apiMode: 'mock',
      apiBase: 'http://localhost:3000/api/v1',
    },
  },

  // Nitro preset 用環境變數 NITRO_PRESET 切換（github_pages／vercel／node_server），程式不綁平台（PRD §19）
  devtools: { enabled: false },
})
