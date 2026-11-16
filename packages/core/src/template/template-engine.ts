import type {
  Template,
  TemplateCategory,
  TemplateTimeline,
  TemplateTrack,
  TemplateClip,
  TemplateSubtitle,
  TemplatePlaceholder,
  TemplateReplacements,
  TemplateSummary,
} from "../types/template";
import type { Project, MediaItem } from "../types/project";
import type { Clip, Subtitle } from "../types/timeline";
import type {
  ScriptableTemplate,
  ExtendedPlaceholder,
  ScriptableTemplateReplacements,
  TemplateValidationError,
  TemplateApplicationResult,
  ExtendedPlaceholderConstraints,
} from "../types/scriptable-template";
import {
  captureTemplateProjectContent,
  copySavedTemplate,
  restoreTemplateProjectContent,
  materializeTemplateText,
} from "./template-project-content";

import {
  indexTemplateTargets,
  applyIndexedTemplateTarget,
  removeLegacyTemplateFlags,
  refreshTemplateTargets,
} from "./template-targets";

const TEMPLATE_DB_NAME = "openreel-templates";
const TEMPLATE_STORE_NAME = "templates";
const TEMPLATE_DB_VERSION = 1;

const DEFAULT_TRANSFORM = {
  position: { x: 0.5, y: 0.5 },
  scale: { x: 1, y: 1 },
  rotation: 0,
  anchor: { x: 0.5, y: 0.5 },
  opacity: 1,
};

export const BUILTIN_TEMPLATES: Template[] = [
  {
    id: "builtin-youtube-intro",
    name: "YouTube Intro",
    description: "10-second animated intro with logo and channel name",
    category: "youtube",
    thumbnailUrl: null,
    previewUrl: null,
    createdAt: Date.now(),
    modifiedAt: Date.now(),
    settings: {
      width: 1920,
      height: 1080,
      frameRate: 30,
      sampleRate: 48000,
      channels: 2,
    },
    timeline: {
      tracks: [
        {
          id: "track-video-1",
          type: "video",
          name: "Background",
          clips: [],
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
        {
          id: "track-text-1",
          type: "text",
          name: "Channel Name",
          clips: [
            {
              id: "clip-channel-name",
              mediaId: "text-channel",
              trackId: "track-text-1",
              startTime: 1,
              duration: 8,
              inPoint: 0,
              outPoint: 8,
              effects: [],
              audioEffects: [],
              transform: { ...DEFAULT_TRANSFORM, position: { x: 0.5, y: 0.5 } },
              volume: 1,
              keyframes: [],
              isPlaceholder: true,
              placeholderId: "channel-name",
            },
          ],
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
      ],
      subtitles: [],
      duration: 10,
      markers: [],
    },
    placeholders: [
      {
        id: "channel-name",
        type: "text",
        label: "Channel Name",
        required: true,
        defaultValue: "Your Channel",
      },
    ],
    tags: ["youtube", "intro", "animated"],
    version: "1.0.0",
  },
  {
    id: "builtin-tiktok-promo",
    name: "TikTok Promo",
    description: "Vertical 15-second promo with call-to-action text",
    category: "tiktok",
    thumbnailUrl: null,
    previewUrl: null,
    createdAt: Date.now(),
    modifiedAt: Date.now(),
    settings: {
      width: 1080,
      height: 1920,
      frameRate: 30,
      sampleRate: 48000,
      channels: 2,
    },
    timeline: {
      tracks: [
        {
          id: "track-video-1",
          type: "video",
          name: "Main Video",
          clips: [],
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
        {
          id: "track-text-1",
          type: "text",
          name: "CTA Text",
          clips: [
            {
              id: "clip-cta",
              mediaId: "text-cta",
              trackId: "track-text-1",
              startTime: 10,
              duration: 5,
              inPoint: 0,
              outPoint: 5,
              effects: [],
              audioEffects: [],
              transform: {
                ...DEFAULT_TRANSFORM,
                position: { x: 0.5, y: 0.85 },
              },
              volume: 1,
              keyframes: [],
              isPlaceholder: true,
              placeholderId: "cta-text",
            },
          ],
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
      ],
      subtitles: [],
      duration: 15,
      markers: [],
    },
    placeholders: [
      {
        id: "cta-text",
        type: "text",
        label: "Call to Action",
        required: true,
        defaultValue: "Swipe Up!",
      },
    ],
    tags: ["tiktok", "vertical", "promo"],
    version: "1.0.0",
  },
  {
    id: "builtin-lower-third",
    name: "Lower Third",
    description: "Professional name & title overlay for interviews",
    category: "lower-third",
    thumbnailUrl: null,
    previewUrl: null,
    createdAt: Date.now(),
    modifiedAt: Date.now(),
    settings: {
      width: 1920,
      height: 1080,
      frameRate: 30,
      sampleRate: 48000,
      channels: 2,
    },
    timeline: {
      tracks: [
        {
          id: "track-video-1",
          type: "video",
          name: "Background Video",
          clips: [],
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
        {
          id: "track-text-name",
          type: "text",
          name: "Name",
          clips: [
            {
              id: "clip-name",
              mediaId: "text-name",
              trackId: "track-text-name",
              startTime: 0.5,
              duration: 4,
              inPoint: 0,
              outPoint: 4,
              effects: [],
              audioEffects: [],
              transform: {
                ...DEFAULT_TRANSFORM,
                position: { x: 0.15, y: 0.82 },
              },
              volume: 1,
              keyframes: [],
              isPlaceholder: true,
              placeholderId: "name",
            },
          ],
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
        {
          id: "track-text-title",
          type: "text",
          name: "Title",
          clips: [
            {
              id: "clip-title",
              mediaId: "text-title",
              trackId: "track-text-title",
              startTime: 0.7,
              duration: 3.8,
              inPoint: 0,
              outPoint: 3.8,
              effects: [],
              audioEffects: [],
              transform: {
                ...DEFAULT_TRANSFORM,
                position: { x: 0.15, y: 0.88 },
              },
              volume: 1,
              keyframes: [],
              isPlaceholder: true,
              placeholderId: "title",
            },
          ],
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
      ],
      subtitles: [],
      duration: 5,
      markers: [],
    },
    placeholders: [
      {
        id: "name",
        type: "text",
        label: "Name",
        required: true,
        defaultValue: "John Smith",
      },
      {
        id: "title",
        type: "text",
        label: "Title/Position",
        required: false,
        defaultValue: "CEO, Company Inc.",
      },
    ],
    tags: ["lower-third", "name", "title", "interview"],
    version: "1.0.0",
  },
  {
    id: "builtin-slideshow",
    name: "Photo Slideshow",
    description: "30-second slideshow with 5 image slots",
    category: "slideshow",
    thumbnailUrl: null,
    previewUrl: null,
    createdAt: Date.now(),
    modifiedAt: Date.now(),
    settings: {
      width: 1920,
      height: 1080,
      frameRate: 30,
      sampleRate: 48000,
      channels: 2,
    },
    timeline: {
      tracks: [
        {
          id: "track-images",
          type: "image",
          name: "Photos",
          clips: [
            {
              id: "clip-image-1",
              mediaId: "placeholder-image-1",
              trackId: "track-images",
              startTime: 0,
              duration: 6,
              inPoint: 0,
              outPoint: 6,
              effects: [],
              audioEffects: [],
              transform: DEFAULT_TRANSFORM,
              volume: 1,
              keyframes: [],
              isPlaceholder: true,
              placeholderId: "image-1",
            },
            {
              id: "clip-image-2",
              mediaId: "placeholder-image-2",
              trackId: "track-images",
              startTime: 6,
              duration: 6,
              inPoint: 0,
              outPoint: 6,
              effects: [],
              audioEffects: [],
              transform: DEFAULT_TRANSFORM,
              volume: 1,
              keyframes: [],
              isPlaceholder: true,
              placeholderId: "image-2",
            },
            {
              id: "clip-image-3",
              mediaId: "placeholder-image-3",
              trackId: "track-images",
              startTime: 12,
              duration: 6,
              inPoint: 0,
              outPoint: 6,
              effects: [],
              audioEffects: [],
              transform: DEFAULT_TRANSFORM,
              volume: 1,
              keyframes: [],
              isPlaceholder: true,
              placeholderId: "image-3",
            },
            {
              id: "clip-image-4",
              mediaId: "placeholder-image-4",
              trackId: "track-images",
              startTime: 18,
              duration: 6,
              inPoint: 0,
              outPoint: 6,
              effects: [],
              audioEffects: [],
              transform: DEFAULT_TRANSFORM,
              volume: 1,
              keyframes: [],
              isPlaceholder: true,
              placeholderId: "image-4",
            },
            {
              id: "clip-image-5",
              mediaId: "placeholder-image-5",
              trackId: "track-images",
              startTime: 24,
              duration: 6,
              inPoint: 0,
              outPoint: 6,
              effects: [],
              audioEffects: [],
              transform: DEFAULT_TRANSFORM,
              volume: 1,
              keyframes: [],
              isPlaceholder: true,
              placeholderId: "image-5",
            },
          ],
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
        {
          id: "track-text-caption",
          type: "text",
          name: "Caption",
          clips: [
            {
              id: "clip-caption",
              mediaId: "text-caption",
              trackId: "track-text-caption",
              startTime: 2,
              duration: 26,
              inPoint: 0,
              outPoint: 26,
              effects: [],
              audioEffects: [],
              transform: { ...DEFAULT_TRANSFORM, position: { x: 0.5, y: 0.9 } },
              volume: 1,
              keyframes: [],
              isPlaceholder: true,
              placeholderId: "caption",
            },
          ],
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
      ],
      subtitles: [],
      duration: 30,
      markers: [],
    },
    placeholders: [
      { id: "image-1", type: "media", label: "Photo 1", required: true },
      { id: "image-2", type: "media", label: "Photo 2", required: true },
      { id: "image-3", type: "media", label: "Photo 3", required: true },
      { id: "image-4", type: "media", label: "Photo 4", required: false },
      { id: "image-5", type: "media", label: "Photo 5", required: false },
      {
        id: "caption",
        type: "text",
        label: "Caption",
        required: false,
        defaultValue: "My Photo Album",
      },
    ],
    tags: ["slideshow", "photos", "memories"],
    version: "1.0.0",
  },
  {
    id: "builtin-instagram-reel",
    name: "Instagram Reel",
    description: "30-second vertical reel with animated hook text",
    category: "instagram",
    thumbnailUrl: null,
    previewUrl: null,
    createdAt: Date.now(),
    modifiedAt: Date.now(),
    settings: {
      width: 1080,
      height: 1920,
      frameRate: 30,
      sampleRate: 48000,
      channels: 2,
    },
    timeline: {
      tracks: [
        {
          id: "track-video-1",
          type: "video",
          name: "Main Video",
          clips: [],
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
        {
          id: "track-text-hook",
          type: "text",
          name: "Hook Text",
          clips: [
            {
              id: "clip-hook",
              mediaId: "text-hook",
              trackId: "track-text-hook",
              startTime: 0.5,
              duration: 4,
              inPoint: 0,
              outPoint: 4,
              effects: [],
              audioEffects: [],
              transform: {
                ...DEFAULT_TRANSFORM,
                position: { x: 0.5, y: 0.15 },
              },
              volume: 1,
              keyframes: [],
              isPlaceholder: true,
              placeholderId: "hook-text",
            },
          ],
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
        {
          id: "track-text-cta",
          type: "text",
          name: "CTA",
          clips: [
            {
              id: "clip-cta-reel",
              mediaId: "text-cta-reel",
              trackId: "track-text-cta",
              startTime: 25,
              duration: 5,
              inPoint: 0,
              outPoint: 5,
              effects: [],
              audioEffects: [],
              transform: {
                ...DEFAULT_TRANSFORM,
                position: { x: 0.5, y: 0.85 },
              },
              volume: 1,
              keyframes: [],
              isPlaceholder: true,
              placeholderId: "cta-text",
            },
          ],
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
      ],
      subtitles: [],
      duration: 30,
      markers: [],
    },
    placeholders: [
      {
        id: "hook-text",
        type: "text",
        label: "Hook Text",
        required: true,
        defaultValue: "Wait for it...",
      },
      {
        id: "cta-text",
        type: "text",
        label: "Call to Action",
        required: false,
        defaultValue: "Follow for more!",
      },
    ],
    tags: ["instagram", "reel", "vertical", "hook"],
    version: "1.0.0",
  },
  {
    id: "builtin-youtube-shorts",
    name: "YouTube Short",
    description: "60-second vertical short with title and subscribe CTA",
    category: "youtube",
    thumbnailUrl: null,
    previewUrl: null,
    createdAt: Date.now(),
    modifiedAt: Date.now(),
    settings: {
      width: 1080,
      height: 1920,
      frameRate: 30,
      sampleRate: 48000,
      channels: 2,
    },
    timeline: {
      tracks: [
        {
          id: "track-video-1",
          type: "video",
          name: "Main Video",
          clips: [],
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
        {
          id: "track-text-title",
          type: "text",
          name: "Title",
          clips: [
            {
              id: "clip-title-short",
              mediaId: "text-title-short",
              trackId: "track-text-title",
              startTime: 0,
              duration: 5,
              inPoint: 0,
              outPoint: 5,
              effects: [],
              audioEffects: [],
              transform: { ...DEFAULT_TRANSFORM, position: { x: 0.5, y: 0.1 } },
              volume: 1,
              keyframes: [],
              isPlaceholder: true,
              placeholderId: "title",
            },
          ],
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
        {
          id: "track-text-subscribe",
          type: "text",
          name: "Subscribe CTA",
          clips: [
            {
              id: "clip-subscribe",
              mediaId: "text-subscribe",
              trackId: "track-text-subscribe",
              startTime: 50,
              duration: 10,
              inPoint: 0,
              outPoint: 10,
              effects: [],
              audioEffects: [],
              transform: { ...DEFAULT_TRANSFORM, position: { x: 0.5, y: 0.9 } },
              volume: 1,
              keyframes: [],
              isPlaceholder: true,
              placeholderId: "subscribe-cta",
            },
          ],
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
      ],
      subtitles: [],
      duration: 60,
      markers: [],
    },
    placeholders: [
      {
        id: "title",
        type: "text",
        label: "Video Title",
        required: true,
        defaultValue: "Did You Know?",
      },
      {
        id: "subscribe-cta",
        type: "text",
        label: "Subscribe CTA",
        required: false,
        defaultValue: "Subscribe for more!",
      },
    ],
    tags: ["youtube", "shorts", "vertical", "subscribe"],
    version: "1.0.0",
  },
  {
    id: "builtin-quote-card",
    name: "Quote Card",
    description: "Animated quote card with author attribution",
    category: "instagram",
    thumbnailUrl: null,
    previewUrl: null,
    createdAt: Date.now(),
    modifiedAt: Date.now(),
    settings: {
      width: 1080,
      height: 1080,
      frameRate: 30,
      sampleRate: 48000,
      channels: 2,
    },
    timeline: {
      tracks: [
        {
          id: "track-bg",
          type: "graphics",
          name: "Background",
          clips: [],
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
        {
          id: "track-text-quote",
          type: "text",
          name: "Quote",
          clips: [
            {
              id: "clip-quote",
              mediaId: "text-quote",
              trackId: "track-text-quote",
              startTime: 0.5,
              duration: 9,
              inPoint: 0,
              outPoint: 9,
              effects: [],
              audioEffects: [],
              transform: {
                ...DEFAULT_TRANSFORM,
                position: { x: 0.5, y: 0.45 },
              },
              volume: 1,
              keyframes: [],
              isPlaceholder: true,
              placeholderId: "quote",
            },
          ],
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
        {
          id: "track-text-author",
          type: "text",
          name: "Author",
          clips: [
            {
              id: "clip-author",
              mediaId: "text-author",
              trackId: "track-text-author",
              startTime: 1.5,
              duration: 8,
              inPoint: 0,
              outPoint: 8,
              effects: [],
              audioEffects: [],
              transform: { ...DEFAULT_TRANSFORM, position: { x: 0.5, y: 0.7 } },
              volume: 1,
              keyframes: [],
              isPlaceholder: true,
              placeholderId: "author",
            },
          ],
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
      ],
      subtitles: [],
      duration: 10,
      markers: [],
    },
    placeholders: [
      {
        id: "quote",
        type: "text",
        label: "Quote",
        required: true,
        defaultValue: "The only way to do great work is to love what you do.",
      },
      {
        id: "author",
        type: "text",
        label: "Author",
        required: true,
        defaultValue: "- Steve Jobs",
      },
    ],
    tags: ["instagram", "quote", "inspiration", "square"],
    version: "1.0.0",
  },
  {
    id: "builtin-product-promo",
    name: "Product Promo",
    description: "15-second TikTok-style product showcase",
    category: "tiktok",
    thumbnailUrl: null,
    previewUrl: null,
    createdAt: Date.now(),
    modifiedAt: Date.now(),
    settings: {
      width: 1080,
      height: 1920,
      frameRate: 30,
      sampleRate: 48000,
      channels: 2,
    },
    timeline: {
      tracks: [
        {
          id: "track-product",
          type: "video",
          name: "Product Video",
          clips: [],
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
        {
          id: "track-text-headline",
          type: "text",
          name: "Headline",
          clips: [
            {
              id: "clip-headline",
              mediaId: "text-headline",
              trackId: "track-text-headline",
              startTime: 0,
              duration: 5,
              inPoint: 0,
              outPoint: 5,
              effects: [],
              audioEffects: [],
              transform: {
                ...DEFAULT_TRANSFORM,
                position: { x: 0.5, y: 0.12 },
              },
              volume: 1,
              keyframes: [],
              isPlaceholder: true,
              placeholderId: "headline",
            },
          ],
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
        {
          id: "track-text-price",
          type: "text",
          name: "Price",
          clips: [
            {
              id: "clip-price",
              mediaId: "text-price",
              trackId: "track-text-price",
              startTime: 5,
              duration: 10,
              inPoint: 0,
              outPoint: 10,
              effects: [],
              audioEffects: [],
              transform: {
                ...DEFAULT_TRANSFORM,
                position: { x: 0.5, y: 0.75 },
              },
              volume: 1,
              keyframes: [],
              isPlaceholder: true,
              placeholderId: "price",
            },
          ],
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
        {
          id: "track-text-cta-promo",
          type: "text",
          name: "CTA",
          clips: [
            {
              id: "clip-cta-promo",
              mediaId: "text-cta-promo",
              trackId: "track-text-cta-promo",
              startTime: 10,
              duration: 5,
              inPoint: 0,
              outPoint: 5,
              effects: [],
              audioEffects: [],
              transform: {
                ...DEFAULT_TRANSFORM,
                position: { x: 0.5, y: 0.88 },
              },
              volume: 1,
              keyframes: [],
              isPlaceholder: true,
              placeholderId: "cta",
            },
          ],
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
      ],
      subtitles: [],
      duration: 15,
      markers: [],
    },
    placeholders: [
      {
        id: "headline",
        type: "text",
        label: "Headline",
        required: true,
        defaultValue: "NEW ARRIVAL",
      },
      {
        id: "price",
        type: "text",
        label: "Price",
        required: true,
        defaultValue: "$29.99",
      },
      {
        id: "cta",
        type: "text",
        label: "Call to Action",
        required: true,
        defaultValue: "Shop Now - Link in Bio!",
      },
    ],
    tags: ["tiktok", "product", "promo", "ecommerce"],
    version: "1.0.0",
  },
  {
    id: "builtin-countdown",
    name: "Countdown Timer",
    description: "Event countdown with date and title",
    category: "instagram",
    thumbnailUrl: null,
    previewUrl: null,
    createdAt: Date.now(),
    modifiedAt: Date.now(),
    settings: {
      width: 1080,
      height: 1920,
      frameRate: 30,
      sampleRate: 48000,
      channels: 2,
    },
    timeline: {
      tracks: [
        {
          id: "track-bg-countdown",
          type: "graphics",
          name: "Background",
          clips: [],
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
        {
          id: "track-text-event",
          type: "text",
          name: "Event Name",
          clips: [
            {
              id: "clip-event",
              mediaId: "text-event",
              trackId: "track-text-event",
              startTime: 0,
              duration: 10,
              inPoint: 0,
              outPoint: 10,
              effects: [],
              audioEffects: [],
              transform: {
                ...DEFAULT_TRANSFORM,
                position: { x: 0.5, y: 0.25 },
              },
              volume: 1,
              keyframes: [],
              isPlaceholder: true,
              placeholderId: "event-name",
            },
          ],
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
        {
          id: "track-text-date",
          type: "text",
          name: "Date",
          clips: [
            {
              id: "clip-date",
              mediaId: "text-date",
              trackId: "track-text-date",
              startTime: 1,
              duration: 9,
              inPoint: 0,
              outPoint: 9,
              effects: [],
              audioEffects: [],
              transform: { ...DEFAULT_TRANSFORM, position: { x: 0.5, y: 0.6 } },
              volume: 1,
              keyframes: [],
              isPlaceholder: true,
              placeholderId: "event-date",
            },
          ],
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
        {
          id: "track-text-swipe",
          type: "text",
          name: "Swipe Up",
          clips: [
            {
              id: "clip-swipe",
              mediaId: "text-swipe",
              trackId: "track-text-swipe",
              startTime: 5,
              duration: 5,
              inPoint: 0,
              outPoint: 5,
              effects: [],
              audioEffects: [],
              transform: { ...DEFAULT_TRANSFORM, position: { x: 0.5, y: 0.9 } },
              volume: 1,
              keyframes: [],
              isPlaceholder: true,
              placeholderId: "swipe-cta",
            },
          ],
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
      ],
      subtitles: [],
      duration: 10,
      markers: [],
    },
    placeholders: [
      {
        id: "event-name",
        type: "text",
        label: "Event Name",
        required: true,
        defaultValue: "LAUNCH DAY",
      },
      {
        id: "event-date",
        type: "text",
        label: "Date",
        required: true,
        defaultValue: "January 20th",
      },
      {
        id: "swipe-cta",
        type: "text",
        label: "Swipe CTA",
        required: false,
        defaultValue: "Swipe Up for Details",
      },
    ],
    tags: ["instagram", "stories", "countdown", "event"],
    version: "1.0.0",
  },
];

export class TemplateEngine {
  private db: IDBDatabase | null = null;
  private opening: Promise<void> | null = null;
  private templates: Map<string, Template> = new Map();

  async initialize(): Promise<void> {
    if (this.db) return;
    if (this.opening) return this.opening;

    this.opening = new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(TEMPLATE_DB_NAME, TEMPLATE_DB_VERSION);

      request.onerror = () => reject(request.error);

      request.onsuccess = () => {
        this.db = request.result;
        this.loadBuiltinTemplates();
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        if (!db.objectStoreNames.contains(TEMPLATE_STORE_NAME)) {
          db.createObjectStore(TEMPLATE_STORE_NAME, { keyPath: "id" });
        }
      };
    });
    try {
      await this.opening;
    } finally {
      this.opening = null;
    }
  }

  private loadBuiltinTemplates(): void {
    for (const template of BUILTIN_TEMPLATES) {
      this.templates.set(template.id, copySavedTemplate(template));
    }
  }

  createFromProject(
    project: Project,
    options: {
      name: string;
      description: string;
      category: TemplateCategory;
      placeholders: TemplatePlaceholder[];
      tags?: string[];
    },
  ): Template {
    const templateId = `template-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    const templateTimeline = this.convertToTemplateTimeline(
      structuredClone(project.timeline),
      options.placeholders,
    );

    return {
      id: templateId,
      name: options.name,
      description: options.description,
      category: options.category,
      thumbnailUrl: null,
      previewUrl: null,
      createdAt: Date.now(),
      modifiedAt: Date.now(),
      settings: structuredClone(project.settings),
      timeline: templateTimeline,
      projectContent: captureTemplateProjectContent(project),
      placeholders: structuredClone(options.placeholders),
      tags: [...(options.tags || [])],
      version: "1.1.0",
    };
  }

  private convertToTemplateTimeline(
    timeline: Project["timeline"],
    placeholders: TemplatePlaceholder[],
  ): TemplateTimeline {
    const placeholderIds = new Set(placeholders.map((p) => p.id));

    const templateTracks: TemplateTrack[] = timeline.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((clip) =>
        this.convertToTemplateClip(clip, placeholderIds),
      ),
    }));

    const templateSubtitles: TemplateSubtitle[] = timeline.subtitles.map(
      (sub) => ({
        ...sub,
        isPlaceholder: false,
      }),
    );

    return {
      ...timeline,
      tracks: templateTracks,
      subtitles: templateSubtitles,
    };
  }

  private convertToTemplateClip(
    clip: Clip,
    placeholderIds: Set<string>,
  ): TemplateClip {
    return {
      ...clip,
      isPlaceholder: placeholderIds.has(clip.mediaId),
      placeholderId: placeholderIds.has(clip.mediaId)
        ? clip.mediaId
        : undefined,
    };
  }

  applyTemplate(
    savedTemplate: Template,
    replacements: TemplateReplacements,
  ): {
    project: Project;
    missingPlaceholders: string[];
    textClips: Array<{ id: string; text: string; placeholderId: string }>;
  } {
    const template = copySavedTemplate(savedTemplate);
    const missingPlaceholders: string[] = [];
    const textClips: Array<{
      id: string;
      text: string;
      placeholderId: string;
    }> = [];

    const effectiveReplacements = { ...replacements };
    for (const placeholder of template.placeholders) {
      if (!effectiveReplacements[placeholder.id] && placeholder.defaultValue) {
        effectiveReplacements[placeholder.id] = {
          type: placeholder.type,
          value: placeholder.defaultValue,
        };
      }
      const replacement = effectiveReplacements[placeholder.id];
      if (
        placeholder.required &&
        (!replacement ||
          (!replacement.mediaBlob &&
            (typeof replacement.value !== "string" ||
              !replacement.value.trim())))
      ) {
        missingPlaceholders.push(placeholder.label);
      }
    }

    const projectId = `project-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    const mediaItems = this.createMediaFromReplacements(
      effectiveReplacements,
      template.placeholders,
    );
    const content = restoreTemplateProjectContent(template, mediaItems);

    const tracks = template.timeline.tracks.map((track) => {
      const clips = track.clips.map((clip) => {
        const resolved = this.resolveClipPlaceholder(
          clip,
          effectiveReplacements,
        );
        if (clip.isPlaceholder && clip.placeholderId) {
          const placeholder = template.placeholders.find(
            (p) => p.id === clip.placeholderId,
          );
          if (placeholder?.type === "text") {
            const textValue =
              effectiveReplacements[clip.placeholderId]?.value ??
              placeholder.defaultValue ??
              "Text";
            textClips.push({
              id: clip.id,
              text: textValue,
              placeholderId: clip.placeholderId,
            });
          }
        }
        return resolved;
      });
      return { ...track, clips };
    });

    const project: Project = {
      ...content,
      id: projectId,
      name: `${template.name} - Copy`,
      createdAt: Date.now(),
      modifiedAt: Date.now(),
      settings: template.settings,
      mediaLibrary: content.mediaLibrary,
      timeline: {
        ...template.timeline,
        tracks,
        subtitles: template.timeline.subtitles.map((sub) =>
          this.resolveSubtitlePlaceholder(sub, effectiveReplacements),
        ),
      },
    };

    return {
      project: materializeTemplateText(
        project,
        textClips,
        template.placeholders,
      ),
      missingPlaceholders,
      textClips,
    };
  }

  private createMediaFromReplacements(
    replacements: TemplateReplacements,
    placeholders: TemplatePlaceholder[],
  ): MediaItem[] {
    const items: MediaItem[] = [];

    for (const placeholder of placeholders) {
      const replacement = replacements[placeholder.id];
      if (replacement && replacement.type === "media") {
        const blob =
          replacement.mediaBlob instanceof Blob &&
          replacement.mediaBlob.size > 0
            ? replacement.mediaBlob
            : null;
        const media = replacement.media;
        items.push({
          id: placeholder.id,
          name: media?.name || replacement.value || placeholder.label,
          type:
            media?.type ??
            (blob?.type.startsWith("video/")
              ? "video"
              : blob?.type.startsWith("audio/")
                ? "audio"
                : "image"),
          fileHandle: null,
          blob,
          metadata: media
            ? {
                ...structuredClone(media.metadata),
                fileSize: blob?.size ?? media.metadata.fileSize,
              }
            : {
                duration: 0,
                width: 1920,
                height: 1080,
                frameRate: 30,
                codec: "",
                sampleRate: 0,
                channels: 0,
                fileSize: blob?.size ?? 0,
              },
          thumbnailUrl: null,
          waveformData: null,
          isPlaceholder: !blob,
        });
      }
    }

    return items;
  }

  private resolveClipPlaceholder(
    clip: TemplateClip,
    replacements: TemplateReplacements,
  ): Clip {
    if (!clip.isPlaceholder || !clip.placeholderId) {
      const {
        isPlaceholder: _isPlaceholder,
        placeholderId: _placeholderId,
        ...clipData
      } = clip;
      return clipData as Clip;
    }

    const replacement = replacements[clip.placeholderId];
    if (!replacement) {
      const {
        isPlaceholder: _isPlaceholder,
        placeholderId: _placeholderId,
        ...clipData
      } = clip;
      return clipData as Clip;
    }

    const {
      isPlaceholder: _isPlaceholder,
      placeholderId: _placeholderId,
      ...clipData
    } = clip;
    const preserveMediaId =
      clip.mediaId.startsWith("text-") ||
      clip.mediaId.startsWith("shape-") ||
      clip.mediaId.startsWith("svg-");
    return {
      ...clipData,
      mediaId: preserveMediaId ? clip.mediaId : clip.placeholderId,
    } as Clip;
  }

  private resolveSubtitlePlaceholder(
    subtitle: TemplateSubtitle,
    replacements: TemplateReplacements,
  ): Subtitle {
    if (!subtitle.isPlaceholder || !subtitle.placeholderId) {
      const {
        isPlaceholder: _isPlaceholder,
        placeholderId: _placeholderId,
        ...subData
      } = subtitle;
      return subData as Subtitle;
    }

    const replacement = replacements[subtitle.placeholderId];
    if (
      !replacement ||
      (replacement.type !== "text" && replacement.type !== "subtitle")
    ) {
      const {
        isPlaceholder: _isPlaceholder,
        placeholderId: _placeholderId,
        ...subData
      } = subtitle;
      return subData as Subtitle;
    }

    const {
      isPlaceholder: _isPlaceholder,
      placeholderId: _placeholderId,
      ...subData
    } = subtitle;
    return {
      ...subData,
      text: replacement.value,
    } as Subtitle;
  }

  resolvePropertyPath(
    obj: Record<string, unknown>,
    path: string,
  ): { parent: Record<string, unknown>; key: string; value: unknown } | null {
    const parts = path.split(".");
    if (
      !path ||
      parts.some(
        (part) =>
          !part || /^(?:__proto__|constructor|prototype)(?:\[|$)/.test(part),
      )
    )
      return null;
    let current: Record<string, unknown> = obj;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      const arrayMatch = part.match(/^(\w+)\[(\d+)\]$/);

      if (arrayMatch) {
        const [, arrayName, indexStr] = arrayMatch;
        const arr = current[arrayName];
        if (!Array.isArray(arr)) return null;
        const index = parseInt(indexStr, 10);
        if (index < 0 || index >= arr.length) return null;
        current = arr[index] as Record<string, unknown>;
      } else {
        if (current[part] === undefined || current[part] === null) return null;
        if (typeof current[part] !== "object") return null;
        current = current[part] as Record<string, unknown>;
      }
    }

    const lastPart = parts[parts.length - 1];
    const lastArrayMatch = lastPart.match(/^(\w+)\[(\d+)\]$/);

    if (lastArrayMatch) {
      const [, arrayName, indexStr] = lastArrayMatch;
      const arr = current[arrayName];
      if (!Array.isArray(arr)) return null;
      const index = parseInt(indexStr, 10);
      if (!Number.isSafeInteger(index) || index < 0 || index > arr.length)
        return null;
      return {
        parent: current,
        key: arrayName,
        value: arr[index],
      };
    }

    return {
      parent: current,
      key: lastPart,
      value: current[lastPart],
    };
  }

  setPropertyByPath(
    obj: Record<string, unknown>,
    path: string,
    value: unknown,
  ): boolean {
    const resolved = this.resolvePropertyPath(obj, path);
    if (!resolved) return false;

    const { parent, key } = resolved;
    const lastPart = path.split(".").pop() || "";
    const arrayMatch = lastPart.match(/^(\w+)\[(\d+)\]$/);

    if (arrayMatch) {
      const [, arrayName, indexStr] = arrayMatch;
      const arr = parent[arrayName];
      if (!Array.isArray(arr)) return false;
      const index = parseInt(indexStr, 10);
      arr[index] = value;
    } else {
      parent[key] = value;
    }

    return true;
  }

  validatePlaceholderValue(
    placeholder: ExtendedPlaceholder,
    value: unknown,
  ): TemplateValidationError | null {
    if (
      placeholder.required &&
      (value === undefined ||
        value === null ||
        (typeof value === "string" && !value.trim()))
    ) {
      return {
        placeholderId: placeholder.id,
        message: `${placeholder.label} is required`,
        type: "missing",
      };
    }

    if (value === undefined || value === null) return null;

    const constraints = placeholder.constraints as
      | ExtendedPlaceholderConstraints
      | undefined;

    switch (placeholder.type) {
      case "text":
      case "subtitle":
        if (typeof value !== "string") {
          return {
            placeholderId: placeholder.id,
            message: `${placeholder.label} must be a string`,
            type: "invalid",
          };
        }
        if (
          constraints?.maxLength !== undefined &&
          value.length > constraints.maxLength
        ) {
          return {
            placeholderId: placeholder.id,
            message: `${placeholder.label} exceeds maximum length of ${constraints.maxLength}`,
            type: "constraint",
          };
        }
        if (constraints?.pattern) {
          let regex: RegExp;
          try {
            regex = new RegExp(constraints.pattern);
          } catch {
            return {
              placeholderId: placeholder.id,
              message: `${placeholder.label} has an invalid pattern constraint`,
              type: "constraint",
            };
          }
          if (!regex.test(value)) {
            return {
              placeholderId: placeholder.id,
              message: `${placeholder.label} does not match required pattern`,
              type: "constraint",
            };
          }
        }
        break;

      case "number":
        if (typeof value !== "number" || !Number.isFinite(value)) {
          return {
            placeholderId: placeholder.id,
            message: `${placeholder.label} must be a finite number`,
            type: "invalid",
          };
        }
        if (constraints?.min !== undefined && value < constraints.min) {
          return {
            placeholderId: placeholder.id,
            message: `${placeholder.label} must be at least ${constraints.min}`,
            type: "constraint",
          };
        }
        if (constraints?.max !== undefined && value > constraints.max) {
          return {
            placeholderId: placeholder.id,
            message: `${placeholder.label} must be at most ${constraints.max}`,
            type: "constraint",
          };
        }
        break;

      case "boolean":
        if (typeof value !== "boolean") {
          return {
            placeholderId: placeholder.id,
            message: `${placeholder.label} must be a boolean`,
            type: "invalid",
          };
        }
        break;

      case "color":
        if (
          typeof value !== "string" ||
          !/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(value)
        ) {
          return {
            placeholderId: placeholder.id,
            message: `${placeholder.label} must be a valid hex color`,
            type: "invalid",
          };
        }
        break;
    }

    if (
      constraints?.allowedValues &&
      !constraints.allowedValues.includes(String(value))
    ) {
      return {
        placeholderId: placeholder.id,
        message: `${placeholder.label} must be one of: ${constraints.allowedValues.join(", ")}`,
        type: "constraint",
      };
    }

    const allowed =
      placeholder.type === "font"
        ? constraints?.allowedFonts
        : placeholder.type === "animation"
          ? constraints?.allowedAnimations
          : undefined;
    if (allowed && !allowed.includes(String(value)))
      return {
        placeholderId: placeholder.id,
        message: `${placeholder.label} must be one of: ${allowed.join(", ")}`,
        type: "constraint",
      };

    return null;
  }

  applyScriptableTemplate(
    savedTemplate: ScriptableTemplate,
    replacements: ScriptableTemplateReplacements,
  ): {
    project: Project;
    result: TemplateApplicationResult;
    textClips: Array<{
      id: string;
      text: string;
      placeholderId: string;
      trackId: string;
      startTime: number;
      duration: number;
      transform: unknown;
    }>;
  } {
    const template = copySavedTemplate(savedTemplate);
    const errors: TemplateValidationError[] = [];
    const warnings: string[] = [];
    const textClips: Array<{
      id: string;
      text: string;
      placeholderId: string;
      trackId: string;
      startTime: number;
      duration: number;
      transform: unknown;
    }> = [];

    const effectiveReplacements = { ...replacements };
    for (const placeholder of template.placeholders) {
      if (
        !effectiveReplacements[placeholder.id] &&
        placeholder.defaultValue !== undefined
      ) {
        effectiveReplacements[placeholder.id] = {
          type: placeholder.type,
          value: placeholder.defaultValue,
        };
      }

      const validationError = this.validatePlaceholderValue(
        placeholder,
        effectiveReplacements[placeholder.id]?.value,
      );
      if (validationError) {
        errors.push(validationError);
      }
    }

    const projectId = `project-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    const timelineClone = structuredClone(template.timeline);
    const mediaItems = this.createMediaFromScriptableReplacements(
      effectiveReplacements,
      template.placeholders,
    );
    const content = restoreTemplateProjectContent(template, mediaItems);

    const targetIndex = indexTemplateTargets(timelineClone, content);

    for (const placeholder of template.placeholders) {
      const replacement = effectiveReplacements[placeholder.id];
      if (!replacement) continue;

      for (const target of placeholder.targets) {
        warnings.push(
          ...applyIndexedTemplateTarget(
            targetIndex,
            target,
            replacement.value,
            placeholder,
            (subject, path, value) =>
              this.setPropertyByPath(subject, path, value),
          ),
        );
      }

      refreshTemplateTargets(targetIndex);
      if (placeholder.type === "text") {
        const matches = new Map<string, Record<string, unknown>>();
        for (const target of placeholder.targets) {
          if (!target.clipId) continue;
          const match = targetIndex.clips.get(target.clipId)?.[0];
          if (match) matches.set(target.clipId, match);
        }
        if (!matches.size)
          for (const clip of targetIndex.legacy.get(placeholder.id) ?? [])
            matches.set(String(clip.id), clip);
        for (const [id, subject] of matches) {
          const clip = subject as unknown as Pick<
            Clip,
            "trackId" | "startTime" | "duration" | "transform"
          >;
          textClips.push({
            id,
            text: String(replacement.value ?? placeholder.defaultValue ?? ""),
            placeholderId: placeholder.id,
            trackId: clip.trackId,
            startTime: clip.startTime,
            duration: clip.duration,
            transform: clip.transform,
          });
        }
      } else if (placeholder.type === "subtitle") {
        for (const caption of targetIndex.legacySubtitles.get(placeholder.id) ??
          [])
          caption.text = String(
            replacement.value ?? placeholder.defaultValue ?? "",
          );
      } else if (placeholder.type === "media" || placeholder.type === "audio") {
        for (const clip of targetIndex.legacy.get(placeholder.id) ?? [])
          clip.mediaId = placeholder.id;
      }
    }
    removeLegacyTemplateFlags(targetIndex);

    const project: Project = {
      ...content,
      id: projectId,
      name: `${template.name} - Copy`,
      createdAt: Date.now(),
      modifiedAt: Date.now(),
      settings: template.settings,
      mediaLibrary: content.mediaLibrary,
      timeline: timelineClone,
    };

    return {
      project: materializeTemplateText(
        project,
        textClips,
        template.placeholders,
        true,
      ),
      result: {
        success: errors.length === 0,
        errors,
        warnings,
      },
      textClips,
    };
  }

  private createMediaFromScriptableReplacements(
    replacements: ScriptableTemplateReplacements,
    placeholders: ExtendedPlaceholder[],
  ): MediaItem[] {
    const items: MediaItem[] = [];

    for (const placeholder of placeholders) {
      const replacement = replacements[placeholder.id];
      if (
        replacement &&
        (replacement.type === "media" || replacement.type === "audio")
      ) {
        const blob =
          replacement.mediaBlob instanceof Blob &&
          replacement.mediaBlob.size > 0
            ? replacement.mediaBlob
            : null;
        const media = replacement.media;
        const value = replacement.value;
        items.push({
          id: placeholder.id,
          name:
            media?.name ||
            (typeof value === "string" ? value : placeholder.label),
          type:
            media?.type ??
            (replacement.type === "audio" || blob?.type.startsWith("audio/")
              ? "audio"
              : blob?.type.startsWith("video/")
                ? "video"
                : "image"),
          fileHandle: null,
          blob,
          metadata: media
            ? {
                ...structuredClone(media.metadata),
                fileSize: blob?.size ?? media.metadata.fileSize,
              }
            : {
                duration: 0,
                width: 1920,
                height: 1080,
                frameRate: 30,
                codec: "",
                sampleRate: 0,
                channels: 0,
                fileSize: blob?.size ?? 0,
              },
          thumbnailUrl: null,
          waveformData: null,
          isPlaceholder: !blob,
        });
      }
    }

    return items;
  }

  async saveTemplate(
    template: Template,
    options: { signal?: AbortSignal } = {},
  ): Promise<void> {
    const signal = options.signal;
    signal?.throwIfAborted();
    if (!this.db) await this.initialize();
    signal?.throwIfAborted();
    const saved = copySavedTemplate(template);

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(
        [TEMPLATE_STORE_NAME],
        "readwrite",
      );
      let settled = false;
      const cancel = () => {
        try {
          transaction.abort();
        } catch {
          /* Already completed. */
        }
      };
      const finish = (committed: boolean, error?: unknown) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", cancel);
        if (committed) {
          this.templates.set(saved.id, saved);
          resolve();
        } else reject(error);
      };
      transaction.oncomplete = () => finish(true);
      transaction.onerror = () =>
        finish(
          false,
          transaction.error ?? new Error("Could not save template"),
        );
      transaction.onabort = () =>
        finish(
          false,
          transaction.error ??
            signal?.reason ??
            new DOMException("Template save cancelled", "AbortError"),
        );
      signal?.addEventListener("abort", cancel, { once: true });
      try {
        transaction.objectStore(TEMPLATE_STORE_NAME).put(saved);
      } catch (error) {
        cancel();
        finish(false, error);
      }
    });
  }

  async loadTemplate(id: string): Promise<Template | null> {
    if (this.templates.has(id)) {
      const template = this.templates.get(id);
      return template ? copySavedTemplate(template) : null;
    }

    if (!this.db) await this.initialize();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(
        [TEMPLATE_STORE_NAME],
        "readonly",
      );
      const store = transaction.objectStore(TEMPLATE_STORE_NAME);
      const request = store.get(id);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const template = request.result as Template | undefined;
        if (template) {
          this.templates.set(template.id, copySavedTemplate(template));
        }
        resolve(template ? copySavedTemplate(template) : null);
      };
    });
  }

  async deleteTemplate(id: string): Promise<void> {
    if (id.startsWith("builtin-")) {
      throw new Error("Cannot delete built-in templates");
    }

    if (!this.db) await this.initialize();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(
        [TEMPLATE_STORE_NAME],
        "readwrite",
      );
      const store = transaction.objectStore(TEMPLATE_STORE_NAME);
      const request = store.delete(id);

      request.onerror = () => reject(request.error);
      transaction.onabort = () =>
        reject(
          transaction.error ?? new Error("Template deletion was cancelled"),
        );
      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => {
        this.templates.delete(id);
        resolve();
      };
    });
  }

  async listTemplates(): Promise<TemplateSummary[]> {
    if (!this.db) await this.initialize();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(
        [TEMPLATE_STORE_NAME],
        "readonly",
      );
      const store = transaction.objectStore(TEMPLATE_STORE_NAME);
      // Saved templates may contain large originals. Only keep one record live
      // while constructing the lightweight catalog, rather than cloning all media.
      const request = store.openCursor();
      const customTemplates: TemplateSummary[] = [];
      transaction.onabort = () =>
        reject(
          transaction.error ?? new Error("Template listing was cancelled"),
        );
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          customTemplates.push(this.toSummary(cursor.value as Template));
          cursor.continue();
        }
      };
      transaction.oncomplete = () => {
        const builtinSummaries = BUILTIN_TEMPLATES.map(this.toSummary);
        resolve([...builtinSummaries, ...customTemplates]);
      };
    });
  }

  getTemplatesByCategory(category: TemplateCategory): Template[] {
    const result: Template[] = [];
    for (const template of this.templates.values()) {
      if (template.category === category) {
        result.push(copySavedTemplate(template));
      }
    }
    return result;
  }

  searchTemplates(query: string): Template[] {
    const lowerQuery = query.toLowerCase();
    const result: Template[] = [];

    for (const template of this.templates.values()) {
      const matchesName = template.name.toLowerCase().includes(lowerQuery);
      const matchesDescription = template.description
        .toLowerCase()
        .includes(lowerQuery);
      const matchesTags = template.tags.some((tag) =>
        tag.toLowerCase().includes(lowerQuery),
      );

      if (matchesName || matchesDescription || matchesTags) {
        result.push(copySavedTemplate(template));
      }
    }

    return result;
  }

  private toSummary(template: Template): TemplateSummary {
    return {
      id: template.id,
      name: template.name,
      category: template.category,
      thumbnailUrl: template.thumbnailUrl,
      placeholderCount: template.placeholders.length,
      duration: template.timeline.duration,
    };
  }

  getBuiltinTemplates(): Template[] {
    return BUILTIN_TEMPLATES.map(copySavedTemplate);
  }

  getAllTemplates(): Template[] {
    return Array.from(this.templates.values(), copySavedTemplate);
  }
}
