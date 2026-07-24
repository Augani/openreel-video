import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const FONT_CSS_URL =
  "https://fonts.googleapis.com/css2?family=Abril+Fatface&family=Alfa+Slab+One&family=Anton&family=Archivo+Black&family=Bangers&family=Bebas+Neue&family=Black+Ops+One&family=Bungee&family=Caveat:wght@400;700&family=Cinzel:wght@400;700;900&family=Comfortaa:wght@300;400;700&family=Concert+One&family=Creepster&family=Dancing+Script:wght@400;700&family=DM+Sans:wght@400;500;700&family=DM+Serif+Display&family=Fredoka+One&family=Geist:wght@400;500;600;700;800&family=Geist+Mono:wght@400;500;600&family=Great+Vibes&family=Inter:wght@300;400;500;600;700;800;900&family=Lato:wght@300;400;700;900&family=Lexend:wght@300;400;500;600;700&family=Lobster&family=Lora:wght@400;500;600;700&family=Merriweather:wght@300;400;700;900&family=Montserrat:wght@300;400;500;600;700;800;900&family=Nunito:wght@300;400;600;700;800&family=Open+Sans:wght@300;400;600;700;800&family=Oswald:wght@300;400;500;600;700&family=Outfit:wght@300;400;500;600;700;800&family=Pacifico&family=Permanent+Marker&family=Playfair+Display:wght@400;500;600;700;800;900&family=Poppins:wght@300;400;500;600;700;800;900&family=Press+Start+2P&family=Quicksand:wght@300;400;500;600;700&family=Raleway:wght@300;400;500;600;700;800&family=Righteous&family=Roboto:wght@300;400;500;700;900&family=Roboto+Condensed:wght@300;400;700&family=Roboto+Mono:wght@300;400;500;700&family=Roboto+Slab:wght@300;400;500;700&family=Rock+Salt&family=Rubik:wght@300;400;500;600;700;800&family=Sacramento&family=Satisfy&family=Space+Grotesk:wght@300;400;500;600;700&family=Space+Mono:wght@400;700&family=Staatliches&family=Teko:wght@300;400;500;600;700&family=Titan+One&family=Ubuntu:wght@300;400;500;700&family=Work+Sans:wght@300;400;500;600;700;800&family=Yellowtail&family=Zilla+Slab:wght@300;400;500;600;700&display=swap";

const OUT_DIR = path.resolve(process.cwd(), "public/fonts");

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const css = await (
    await fetch(FONT_CSS_URL, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      },
    })
  ).text();

  const urls = [...css.matchAll(/url\((https:\/\/[^)]+\.woff2)\)/g)].map((m) => m[1]);
  let rewritten = css;
  for (const url of urls) {
    const file = url.split("/").pop();
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
    await writeFile(path.join(OUT_DIR, file), buf);
    rewritten = rewritten.replaceAll(url, `./${file}`);
  }
  await writeFile(path.join(OUT_DIR, "google-fonts.css"), rewritten, "utf8");
  console.log(`vendored ${urls.length} font files`);
}
main();
