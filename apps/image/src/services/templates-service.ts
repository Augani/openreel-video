import { CanvasSize, CanvasBackground, Layer, TextLayer, ShapeLayer, DEFAULT_TRANSFORM, DEFAULT_BLEND_MODE, DEFAULT_SHADOW, DEFAULT_STROKE, DEFAULT_GLOW, DEFAULT_FILTER, DEFAULT_TEXT_STYLE, DEFAULT_SHAPE_STYLE } from '../types/project';

export interface TemplateCategory {
  id: string;
  name: string;
  templates: Template[];
}

export interface Template {
  id: string;
  name: string;
  thumbnail: string;
  category: string;
  size: CanvasSize;
  background: CanvasBackground;
  layers: Partial<Layer>[];
}

const generateId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

const createTextLayer = (
  content: string,
  x: number,
  y: number,
  width: number,
  fontSize: number,
  fontWeight: number,
  color: string,
  textAlign: 'left' | 'center' | 'right' = 'center'
): Partial<TextLayer> => ({
  id: generateId(),
  name: content.slice(0, 20),
  type: 'text',
  visible: true,
  locked: false,
  transform: { ...DEFAULT_TRANSFORM, x, y, width, height: fontSize * 1.5 },
  blendMode: DEFAULT_BLEND_MODE,
  shadow: DEFAULT_SHADOW,
  stroke: DEFAULT_STROKE,
  glow: DEFAULT_GLOW,
  filters: DEFAULT_FILTER,
  parentId: null,
  content,
  style: { ...DEFAULT_TEXT_STYLE, fontSize, fontWeight, color, textAlign },
  autoSize: true,
});

const createShapeLayer = (
  shapeType: ShapeLayer['shapeType'],
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string | null,
  cornerRadius = 0
): Partial<ShapeLayer> => ({
  id: generateId(),
  name: shapeType.charAt(0).toUpperCase() + shapeType.slice(1),
  type: 'shape',
  visible: true,
  locked: false,
  transform: { ...DEFAULT_TRANSFORM, x, y, width, height },
  blendMode: DEFAULT_BLEND_MODE,
  shadow: DEFAULT_SHADOW,
  stroke: DEFAULT_STROKE,
  glow: DEFAULT_GLOW,
  filters: DEFAULT_FILTER,
  parentId: null,
  shapeType,
  shapeStyle: { ...DEFAULT_SHAPE_STYLE, fill, cornerRadius },
});

export const TEMPLATE_CATEGORIES: TemplateCategory[] = [
  {
    id: 'social-media',
    name: 'Social Media',
    templates: [
      {
        id: 'instagram-post-minimal',
        name: 'Minimal Quote',
        thumbnail: '',
        category: 'social-media',
        size: { width: 1080, height: 1080 },
        background: { type: 'color', color: '#1a1a2e' },
        layers: [
          createTextLayer('"Your inspiring quote goes here"', 90, 400, 900, 42, 500, '#ffffff', 'center'),
          createTextLayer('— Author Name', 90, 520, 900, 24, 400, '#888888', 'center'),
          createShapeLayer('rectangle', 440, 350, 200, 4, '#4a90d9'),
        ],
      },
      {
        id: 'instagram-post-gradient',
        name: 'Gradient Announcement',
        thumbnail: '',
        category: 'social-media',
        size: { width: 1080, height: 1080 },
        background: {
          type: 'gradient',
          gradient: {
            type: 'linear',
            angle: 135,
            stops: [
              { offset: 0, color: '#667eea' },
              { offset: 1, color: '#764ba2' },
            ],
          },
        },
        layers: [
          createTextLayer('NEW', 90, 300, 900, 24, 700, '#ffffff', 'center'),
          createTextLayer('Big Announcement', 90, 380, 900, 56, 700, '#ffffff', 'center'),
          createTextLayer('Add your description here. Keep it short and engaging.', 140, 480, 800, 20, 400, 'rgba(255,255,255,0.8)', 'center'),
          createShapeLayer('rectangle', 390, 600, 300, 56, '#ffffff', 28),
          createTextLayer('Learn More', 390, 612, 300, 18, 600, '#667eea', 'center'),
        ],
      },
      {
        id: 'instagram-story-promo',
        name: 'Story Promo',
        thumbnail: '',
        category: 'social-media',
        size: { width: 1080, height: 1920 },
        background: { type: 'color', color: '#0f0f0f' },
        layers: [
          createTextLayer('SALE', 90, 700, 900, 120, 900, '#ff3366', 'center'),
          createTextLayer('UP TO 50% OFF', 90, 850, 900, 36, 600, '#ffffff', 'center'),
          createTextLayer('Limited time only', 90, 920, 900, 20, 400, '#888888', 'center'),
          createShapeLayer('rectangle', 340, 1100, 400, 64, '#ff3366', 32),
          createTextLayer('Shop Now', 340, 1116, 400, 20, 600, '#ffffff', 'center'),
        ],
      },
      {
        id: 'youtube-thumbnail',
        name: 'YouTube Thumbnail',
        thumbnail: '',
        category: 'social-media',
        size: { width: 1280, height: 720 },
        background: { type: 'color', color: '#1a1a2e' },
        layers: [
          createShapeLayer('rectangle', 0, 0, 1280, 720, '#000000'),
          createTextLayer('VIDEO TITLE', 60, 280, 800, 72, 900, '#ffffff', 'left'),
          createTextLayer('GOES HERE', 60, 370, 800, 72, 900, '#ffcc00', 'left'),
          createShapeLayer('ellipse', 900, 200, 300, 300, '#ff0000'),
          createTextLayer('NEW', 950, 310, 200, 48, 700, '#ffffff', 'center'),
        ],
      },
    ],
  },
  {
    id: 'business',
    name: 'Business',
    templates: [
      {
        id: 'presentation-title',
        name: 'Presentation Title',
        thumbnail: '',
        category: 'business',
        size: { width: 1920, height: 1080 },
        background: { type: 'color', color: '#ffffff' },
        layers: [
          createTextLayer('Presentation Title', 120, 400, 1200, 64, 700, '#1a1a2e', 'left'),
          createTextLayer('Subtitle or company name', 120, 490, 1200, 28, 400, '#666666', 'left'),
          createShapeLayer('rectangle', 120, 560, 100, 6, '#4a90d9'),
        ],
      },
      {
        id: 'business-card',
        name: 'Business Card',
        thumbnail: '',
        category: 'business',
        size: { width: 1050, height: 600 },
        background: { type: 'color', color: '#ffffff' },
        layers: [
          createShapeLayer('rectangle', 0, 0, 10, 600, '#2563eb'),
          createTextLayer('JOHN DOE', 60, 180, 500, 32, 700, '#1a1a2e', 'left'),
          createTextLayer('Creative Director', 60, 230, 500, 18, 400, '#666666', 'left'),
          createTextLayer('john@company.com', 60, 320, 500, 14, 400, '#2563eb', 'left'),
          createTextLayer('+1 (555) 123-4567', 60, 350, 500, 14, 400, '#666666', 'left'),
        ],
      },
    ],
  },
  {
    id: 'marketing',
    name: 'Marketing',
    templates: [
      {
        id: 'sale-banner',
        name: 'Sale Banner',
        thumbnail: '',
        category: 'marketing',
        size: { width: 1200, height: 628 },
        background: {
          type: 'gradient',
          gradient: {
            type: 'linear',
            angle: 45,
            stops: [
              { offset: 0, color: '#f12711' },
              { offset: 1, color: '#f5af19' },
            ],
          },
        },
        layers: [
          createTextLayer('MEGA SALE', 100, 180, 1000, 96, 900, '#ffffff', 'center'),
          createTextLayer('Save up to 70% on selected items', 100, 310, 1000, 28, 400, 'rgba(255,255,255,0.9)', 'center'),
          createShapeLayer('rectangle', 450, 400, 300, 56, '#ffffff', 28),
          createTextLayer('Shop Now', 450, 414, 300, 18, 600, '#f12711', 'center'),
        ],
      },
      {
        id: 'product-showcase',
        name: 'Product Showcase',
        thumbnail: '',
        category: 'marketing',
        size: { width: 1080, height: 1080 },
        background: { type: 'color', color: '#f8f9fa' },
        layers: [
          createShapeLayer('rectangle', 140, 140, 800, 600, '#ffffff', 16),
          createTextLayer('PRODUCT NAME', 190, 800, 700, 36, 700, '#1a1a2e', 'center'),
          createTextLayer('$99.99', 190, 860, 700, 28, 600, '#2563eb', 'center'),
          createTextLayer('Short product description goes here', 190, 920, 700, 16, 400, '#666666', 'center'),
        ],
      },
    ],
  },
  {
    id: 'personal',
    name: 'Personal',
    templates: [
      {
        id: 'birthday-card',
        name: 'Birthday Card',
        thumbnail: '',
        category: 'personal',
        size: { width: 1080, height: 1080 },
        background: {
          type: 'gradient',
          gradient: {
            type: 'linear',
            angle: 180,
            stops: [
              { offset: 0, color: '#ff9a9e' },
              { offset: 1, color: '#fecfef' },
            ],
          },
        },
        layers: [
          createTextLayer('🎂', 440, 300, 200, 120, 400, '#ffffff', 'center'),
          createTextLayer('Happy Birthday!', 90, 480, 900, 56, 700, '#ffffff', 'center'),
          createTextLayer('Wishing you a wonderful day!', 90, 570, 900, 24, 400, 'rgba(255,255,255,0.9)', 'center'),
        ],
      },
      {
        id: 'thank-you',
        name: 'Thank You Card',
        thumbnail: '',
        category: 'personal',
        size: { width: 1080, height: 1080 },
        background: { type: 'color', color: '#fff8e7' },
        layers: [
          createTextLayer('Thank You', 90, 420, 900, 72, 700, '#d4a574', 'center'),
          createTextLayer('Your support means the world to us', 90, 530, 900, 22, 400, '#8b7355', 'center'),
          createShapeLayer('rectangle', 440, 350, 200, 3, '#d4a574'),
        ],
      },
    ],
  },
  {
    id: 'blank',
    name: 'Blank Canvas',
    templates: [
      {
        id: 'blank-square',
        name: 'Square (1:1)',
        thumbnail: '',
        category: 'blank',
        size: { width: 1080, height: 1080 },
        background: { type: 'color', color: '#ffffff' },
        layers: [],
      },
      {
        id: 'blank-landscape',
        name: 'Landscape (16:9)',
        thumbnail: '',
        category: 'blank',
        size: { width: 1920, height: 1080 },
        background: { type: 'color', color: '#ffffff' },
        layers: [],
      },
      {
        id: 'blank-portrait',
        name: 'Portrait (9:16)',
        thumbnail: '',
        category: 'blank',
        size: { width: 1080, height: 1920 },
        background: { type: 'color', color: '#ffffff' },
        layers: [],
      },
      {
        id: 'blank-a4',
        name: 'A4 Portrait',
        thumbnail: '',
        category: 'blank',
        size: { width: 2480, height: 3508 },
        background: { type: 'color', color: '#ffffff' },
        layers: [],
      },
    ],
  },
];

export function getTemplateById(id: string): Template | null {
  for (const category of TEMPLATE_CATEGORIES) {
    const template = category.templates.find((t) => t.id === id);
    if (template) return template;
  }
  return null;
}

export function getTemplatesByCategory(categoryId: string): Template[] {
  const category = TEMPLATE_CATEGORIES.find((c) => c.id === categoryId);
  return category?.templates ?? [];
}

export function getAllTemplates(): Template[] {
  return TEMPLATE_CATEGORIES.flatMap((c) => c.templates);
}

export function searchTemplates(query: string): Template[] {
  const lowerQuery = query.toLowerCase();
  return getAllTemplates().filter(
    (t) =>
      t.name.toLowerCase().includes(lowerQuery) ||
      t.category.toLowerCase().includes(lowerQuery)
  );
}
