import {fileURLToPath} from 'node:url';
import { defineConfig } from "vite";
export default defineConfig({ resolve: { alias: { "@native": fileURLToPath(new URL("./src/native", import.meta.url)) } }, server: { port: 28731, strictPort: true, proxy: { "/api": { target: "http://127.0.0.1:28730", ws: true } } } });
