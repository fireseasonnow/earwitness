import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import tailwindcss from "@tailwindcss/vite";
import { ORIGIN } from "./src/lib/metadata";

export default defineConfig({
  // Imported, not repeated: the head builds its absolute URLs from the same
  // constant, and two copies of a domain is how one of them goes stale.
  site: ORIGIN,
  // The page reflects live data (`prerender = false`), so a static build is
  // impossible. The data layer reads two plain files through node:fs and pulls in
  // no native binding or runtime builtin, so nothing here constrains which
  // runtime executes the output — see design D7.
  adapter: node({ mode: "standalone" }),
  vite: {
    plugins: [tailwindcss()],
  },
});
