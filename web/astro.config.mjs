import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // The page reflects live data (`prerender = false`), so a static build is
  // impossible. The data layer reads two plain files through node:fs and pulls in
  // no native binding or runtime builtin, so nothing here constrains which
  // runtime executes the output — see design D7.
  adapter: node({ mode: "standalone" }),
  vite: {
    plugins: [tailwindcss()],
  },
});
