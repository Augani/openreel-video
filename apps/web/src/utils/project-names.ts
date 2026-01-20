const CITY_NAMES = [
  "Tokyo", "Paris", "London", "Sydney", "Berlin",
  "Milan", "Seoul", "Dubai", "Oslo", "Vienna",
  "Kyoto", "Prague", "Lisbon", "Boston", "Austin",
  "Denver", "Portland", "Seattle", "Montreal", "Toronto",
  "Barcelona", "Amsterdam", "Stockholm", "Helsinki", "Dublin",
  "Cairo", "Mumbai", "Bangkok", "Singapore", "Zurich",
  "Geneva", "Florence", "Venice", "Naples", "Athens",
  "Lagos", "Nairobi", "Marrakech", "Cape Town", "Havana",
  "Lima", "Rio", "Santiago", "Phoenix", "Chicago",
  "Brooklyn", "Manhattan", "Queens", "Osaka", "Taipei",
];

const ADJECTIVES = [
  "Morning", "Evening", "Midnight", "Golden", "Silver",
  "Crystal", "Velvet", "Neon", "Cosmic", "Electric",
  "Vintage", "Modern", "Classic", "Urban", "Serene",
  "Bold", "Swift", "Vivid", "Radiant", "Mystic",
];

export function generateProjectName(): string {
  const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const city = CITY_NAMES[Math.floor(Math.random() * CITY_NAMES.length)];
  return `${adjective} ${city}`;
}

export function generateSimpleProjectName(): string {
  return CITY_NAMES[Math.floor(Math.random() * CITY_NAMES.length)];
}
