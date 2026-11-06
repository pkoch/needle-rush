import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./tests',testMatch:['browser.spec.ts','finale.browser.spec.ts'],timeout:180000,workers:1,reporter:'line',use:{baseURL:'http://127.0.0.1:5173',headless:true},outputDir:'outputs/browser'});
