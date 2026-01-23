export interface GoogleFont {
  family: string;
  category: 'sans-serif' | 'serif' | 'display' | 'handwriting' | 'monospace';
  variants: string[];
  subsets: string[];
}

export interface FontCategory {
  id: string;
  name: string;
}

export const FONT_CATEGORIES: FontCategory[] = [
  { id: 'all', name: 'All' },
  { id: 'sans-serif', name: 'Sans Serif' },
  { id: 'serif', name: 'Serif' },
  { id: 'display', name: 'Display' },
  { id: 'handwriting', name: 'Handwriting' },
  { id: 'monospace', name: 'Monospace' },
];

const POPULAR_FONTS: GoogleFont[] = [
  { family: 'Inter', category: 'sans-serif', variants: ['400', '500', '600', '700'], subsets: ['latin'] },
  { family: 'Roboto', category: 'sans-serif', variants: ['400', '500', '700'], subsets: ['latin'] },
  { family: 'Open Sans', category: 'sans-serif', variants: ['400', '500', '600', '700'], subsets: ['latin'] },
  { family: 'Montserrat', category: 'sans-serif', variants: ['400', '500', '600', '700'], subsets: ['latin'] },
  { family: 'Poppins', category: 'sans-serif', variants: ['400', '500', '600', '700'], subsets: ['latin'] },
  { family: 'Lato', category: 'sans-serif', variants: ['400', '700'], subsets: ['latin'] },
  { family: 'Oswald', category: 'sans-serif', variants: ['400', '500', '600', '700'], subsets: ['latin'] },
  { family: 'Source Sans 3', category: 'sans-serif', variants: ['400', '600', '700'], subsets: ['latin'] },
  { family: 'Raleway', category: 'sans-serif', variants: ['400', '500', '600', '700'], subsets: ['latin'] },
  { family: 'Nunito', category: 'sans-serif', variants: ['400', '600', '700'], subsets: ['latin'] },
  { family: 'Work Sans', category: 'sans-serif', variants: ['400', '500', '600', '700'], subsets: ['latin'] },
  { family: 'DM Sans', category: 'sans-serif', variants: ['400', '500', '700'], subsets: ['latin'] },
  { family: 'Playfair Display', category: 'serif', variants: ['400', '500', '600', '700'], subsets: ['latin'] },
  { family: 'Merriweather', category: 'serif', variants: ['400', '700'], subsets: ['latin'] },
  { family: 'Lora', category: 'serif', variants: ['400', '500', '600', '700'], subsets: ['latin'] },
  { family: 'PT Serif', category: 'serif', variants: ['400', '700'], subsets: ['latin'] },
  { family: 'Libre Baskerville', category: 'serif', variants: ['400', '700'], subsets: ['latin'] },
  { family: 'Cormorant Garamond', category: 'serif', variants: ['400', '500', '600', '700'], subsets: ['latin'] },
  { family: 'Crimson Text', category: 'serif', variants: ['400', '600', '700'], subsets: ['latin'] },
  { family: 'Bebas Neue', category: 'display', variants: ['400'], subsets: ['latin'] },
  { family: 'Anton', category: 'display', variants: ['400'], subsets: ['latin'] },
  { family: 'Archivo Black', category: 'display', variants: ['400'], subsets: ['latin'] },
  { family: 'Righteous', category: 'display', variants: ['400'], subsets: ['latin'] },
  { family: 'Alfa Slab One', category: 'display', variants: ['400'], subsets: ['latin'] },
  { family: 'Monoton', category: 'display', variants: ['400'], subsets: ['latin'] },
  { family: 'Bungee', category: 'display', variants: ['400'], subsets: ['latin'] },
  { family: 'Pacifico', category: 'handwriting', variants: ['400'], subsets: ['latin'] },
  { family: 'Dancing Script', category: 'handwriting', variants: ['400', '500', '600', '700'], subsets: ['latin'] },
  { family: 'Great Vibes', category: 'handwriting', variants: ['400'], subsets: ['latin'] },
  { family: 'Lobster', category: 'handwriting', variants: ['400'], subsets: ['latin'] },
  { family: 'Satisfy', category: 'handwriting', variants: ['400'], subsets: ['latin'] },
  { family: 'Sacramento', category: 'handwriting', variants: ['400'], subsets: ['latin'] },
  { family: 'Caveat', category: 'handwriting', variants: ['400', '500', '600', '700'], subsets: ['latin'] },
  { family: 'Kalam', category: 'handwriting', variants: ['400', '700'], subsets: ['latin'] },
  { family: 'Indie Flower', category: 'handwriting', variants: ['400'], subsets: ['latin'] },
  { family: 'Fira Code', category: 'monospace', variants: ['400', '500', '600', '700'], subsets: ['latin'] },
  { family: 'JetBrains Mono', category: 'monospace', variants: ['400', '500', '600', '700'], subsets: ['latin'] },
  { family: 'Source Code Pro', category: 'monospace', variants: ['400', '500', '600', '700'], subsets: ['latin'] },
  { family: 'Space Mono', category: 'monospace', variants: ['400', '700'], subsets: ['latin'] },
  { family: 'Roboto Mono', category: 'monospace', variants: ['400', '500', '600', '700'], subsets: ['latin'] },
];

const loadedFonts = new Set<string>();

export function getPopularFonts(): GoogleFont[] {
  return POPULAR_FONTS;
}

export function filterFonts(fonts: GoogleFont[], category: string, search: string): GoogleFont[] {
  let filtered = fonts;

  if (category !== 'all') {
    filtered = filtered.filter((f) => f.category === category);
  }

  if (search) {
    const searchLower = search.toLowerCase();
    filtered = filtered.filter((f) => f.family.toLowerCase().includes(searchLower));
  }

  return filtered;
}

export function loadGoogleFont(fontFamily: string, weights: string[] = ['400', '700']): Promise<void> {
  const key = `${fontFamily}:${weights.join(',')}`;
  if (loadedFonts.has(key)) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const encodedFamily = encodeURIComponent(fontFamily);
    const weightParam = weights.join(';');
    const url = `https://fonts.googleapis.com/css2?family=${encodedFamily}:wght@${weightParam}&display=swap`;

    const existingLink = document.querySelector(`link[href="${url}"]`);
    if (existingLink) {
      loadedFonts.add(key);
      resolve();
      return;
    }

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;

    link.onload = () => {
      loadedFonts.add(key);
      resolve();
    };

    link.onerror = () => {
      reject(new Error(`Failed to load font: ${fontFamily}`));
    };

    document.head.appendChild(link);
  });
}

export function preloadFonts(fonts: GoogleFont[]): void {
  fonts.slice(0, 20).forEach((font) => {
    loadGoogleFont(font.family, font.variants.slice(0, 2));
  });
}

export function isFontLoaded(fontFamily: string): boolean {
  return loadedFonts.has(`${fontFamily}:400,700`) || loadedFonts.has(`${fontFamily}:400`);
}
