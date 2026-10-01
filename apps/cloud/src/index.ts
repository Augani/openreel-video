import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Bindings } from './marketplace/types';
import marketplace from './marketplace/marketplace';
import studio from './marketplace/studio';
import events from './marketplace/events';
import crash from './crash/routes';

const app = new Hono<{ Bindings: Bindings }>();

app.use('/*', cors({
  origin: (origin) => {
    if (!origin) return origin;
    const ok =
      /^http:\/\/localhost:\d+$/.test(origin) ||
      /\.openreel-studio\.pages\.dev$/.test(origin) ||
      origin === 'https://openreel-studio.pages.dev' ||
      /\.openreel\.video$/.test(origin) ||
      origin === 'https://app.openreel.video' ||
      origin === 'https://studio.openreel.video';
    return ok ? origin : undefined;
  },
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Bundle-ID', 'X-User-Id', 'X-Creator-Id', 'X-Creator-Handle'],
  maxAge: 86400,
}));

// Marketplace + Studio API (STUDIO_PLAN §34), mounted under /v1.
app.route('/v1', marketplace);
app.route('/v1', studio);
app.route('/v1', events);

// Desktop/app crash + error collection (POST /crash; guarded GET /crash).
app.route('/', crash);

app.get('/', (c) => {
  return c.json({
    name: 'OpenReel Cloud API',
    version: '1.0.0',
    endpoints: {
      marketplace: {
        assets: 'GET /v1/assets',
        asset: 'GET /v1/assets/:id',
        install: 'POST /v1/assets/:id/install',
        search: 'GET /v1/search?q=',
        blueprints: 'GET /v1/blueprints',
        nodelib: 'GET /v1/nodelib?abi=1.2',
      },
      studio: {
        drafts: 'POST /v1/drafts · PUT /v1/drafts/:id',
        validate: 'POST /v1/drafts/:id/validate',
        submit: 'POST /v1/drafts/:id/submit',
        review: 'POST /v1/submissions/:id/review',
      },
      events: 'POST /v1/events',
      crash: 'POST /crash',
      templates: {
        list: 'GET /templates',
        get: 'GET /templates/:id',
        upload: 'POST /templates',
        delete: 'DELETE /templates/:id',
      },
    },
  });
});

app.get('/templates', async (c) => {
  const bucket = c.env.TEMPLATES_BUCKET;
  const { cursor } = c.req.query();

  try {
    const listed = await bucket.list({
      limit: 100,
      cursor: cursor || undefined,
    });

    const templates = await Promise.all(
      listed.objects.map(async (obj) => {
        const template = await bucket.get(obj.key);
        if (!template) return null;
        const data = await template.json() as Record<string, unknown>;
        return {
          id: obj.key.replace('.json', ''),
          name: data.name,
          category: data.category,
          description: data.description,
          thumbnailUrl: data.thumbnailUrl,
          placeholderCount: (data.placeholders as unknown[] | undefined)?.length || 0,
          duration: (data.timeline as Record<string, unknown> | undefined)?.duration || 0,
          createdAt: data.createdAt,
          tags: data.tags,
          author: data.author,
        };
      })
    );

    return c.json({
      templates: templates.filter(Boolean),
      cursor: listed.truncated ? (listed as { cursor?: string }).cursor : undefined,
      truncated: listed.truncated,
    });
  } catch (error) {
    return c.json({ error: 'Failed to list templates' }, 500);
  }
});

app.get('/templates/:id', async (c) => {
  const id = c.req.param('id');
  const bucket = c.env.TEMPLATES_BUCKET;

  try {
    const template = await bucket.get(`${id}.json`);

    if (!template) {
      return c.json({ error: 'Template not found' }, 404);
    }

    const data = await template.json();
    return c.json(data);
  } catch (error) {
    return c.json({ error: 'Failed to get template' }, 500);
  }
});

app.post('/templates', async (c) => {
  const bucket = c.env.TEMPLATES_BUCKET;

  try {
    const body = await c.req.json();

    if (!body.id || !body.name || !body.timeline) {
      return c.json({ error: 'Invalid template format. Required: id, name, timeline' }, 400);
    }

    const templateId = body.id;
    const key = `${templateId}.json`;

    const existing = await bucket.get(key);
    if (existing) {
      return c.json({ error: 'Template with this ID already exists' }, 409);
    }

    const template = {
      ...body,
      createdAt: body.createdAt || Date.now(),
      modifiedAt: Date.now(),
      version: body.version || '1.0.0',
    };

    await bucket.put(key, JSON.stringify(template, null, 2), {
      httpMetadata: {
        contentType: 'application/json',
      },
      customMetadata: {
        name: template.name,
        category: template.category || 'custom',
        author: template.author || 'anonymous',
      },
    });

    return c.json({
      success: true,
      id: templateId,
      message: 'Template uploaded successfully',
    }, 201);
  } catch (error) {
    console.error('Upload error:', error);
    return c.json({ error: 'Failed to upload template' }, 500);
  }
});

app.delete('/templates/:id', async (c) => {
  const id = c.req.param('id');
  const bucket = c.env.TEMPLATES_BUCKET;

  if (id.startsWith('builtin-')) {
    return c.json({ error: 'Cannot delete built-in templates' }, 403);
  }

  try {
    const key = `${id}.json`;
    await bucket.delete(key);

    return c.json({
      success: true,
      message: 'Template deleted successfully',
    });
  } catch (error) {
    return c.json({ error: 'Failed to delete template' }, 500);
  }
});

app.post('/shares', async (c) => {
  const bucket = c.env.SHARES_BUCKET;

  try {
    const formData = await c.req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return c.json({ error: 'No file provided' }, 400);
    }

    const shareId = crypto.randomUUID();
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000;

    await bucket.put(`shares/${shareId}`, file.stream(), {
      httpMetadata: {
        contentType: file.type || 'video/webm',
      },
      customMetadata: {
        filename: file.name,
        expiresAt: expiresAt.toString(),
        size: file.size.toString(),
      },
    });

    return c.json({
      shareId,
      shareUrl: `https://app.openreel.video/#/share/${shareId}`,
      expiresAt,
    }, 201);
  } catch (error) {
    console.error('Share upload error:', error);
    return c.json({ error: 'Failed to upload file for sharing' }, 500);
  }
});

app.get('/shares/:id', async (c) => {
  const bucket = c.env.SHARES_BUCKET;
  const shareId = c.req.param('id');

  try {
    const object = await bucket.head(`shares/${shareId}`);

    if (!object) {
      return c.json({ error: 'Share not found' }, 404);
    }

    const expiresAt = parseInt(object.customMetadata?.expiresAt || '0');

    if (Date.now() > expiresAt) {
      await bucket.delete(`shares/${shareId}`);
      return c.json({ error: 'Share link has expired' }, 410);
    }

    return c.json({
      shareId,
      filename: object.customMetadata?.filename || 'video.webm',
      size: parseInt(object.customMetadata?.size || '0'),
      expiresAt,
      expiresIn: Math.floor((expiresAt - Date.now()) / 1000 / 60),
    });
  } catch (error) {
    console.error('Get share error:', error);
    return c.json({ error: 'Failed to get share info' }, 500);
  }
});

app.get('/shares/:id/download', async (c) => {
  const bucket = c.env.SHARES_BUCKET;
  const shareId = c.req.param('id');

  try {
    const object = await bucket.get(`shares/${shareId}`);

    if (!object) {
      return c.json({ error: 'Share not found' }, 404);
    }

    const expiresAt = parseInt(object.customMetadata?.expiresAt || '0');

    if (Date.now() > expiresAt) {
      return c.json({ error: 'Share link has expired' }, 410);
    }

    const filename = object.customMetadata?.filename || 'video.webm';

    return new Response(object.body, {
      headers: {
        'Content-Type': object.httpMetadata?.contentType || 'video/webm',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': object.size.toString(),
      },
    });
  } catch (error) {
    console.error('Download share error:', error);
    return c.json({ error: 'Failed to download share' }, 500);
  }
});

app.post('/highlights', async (c) => {
  try {
    const body = await c.req.json() as {
      transcript: Array<{ text: string; start: number; end: number }>;
      energy: Array<{ start: number; end: number; rmsDb: number; peakDb: number }>;
      duration: number;
      preferences?: {
        targetClipCount?: number;
        minClipDuration?: number;
        maxClipDuration?: number;
        contentType?: string;
      };
    };

    if (!body.transcript || !Array.isArray(body.transcript) || body.transcript.length === 0) {
      return c.json({ error: 'transcript array is required and must not be empty' }, 400);
    }

    const prefs = body.preferences || {};
    const targetCount = prefs.targetClipCount || 5;
    const minDuration = prefs.minClipDuration || 5;
    const maxDuration = prefs.maxClipDuration || 60;
    const contentType = prefs.contentType || 'video';

    const transcriptText = body.transcript
      .map((w) => `[${w.start.toFixed(1)}s] ${w.text}`)
      .join(' ');

    const energySummary = body.energy
      .map((e) => `${e.start.toFixed(0)}-${e.end.toFixed(0)}s: ${e.rmsDb.toFixed(1)}dB peak:${e.peakDb.toFixed(1)}dB`)
      .join('\n');

    const prompt = `You are a video editor AI. Analyze this transcript and audio energy data to find the most engaging highlight clips.

Content type: ${contentType}
Total duration: ${body.duration.toFixed(1)}s
Target number of clips: ${targetCount}
Clip duration range: ${minDuration}-${maxDuration} seconds

TRANSCRIPT (with timestamps):
${transcriptText}

AUDIO ENERGY (per segment):
${energySummary}

Find the ${targetCount} most engaging moments. Look for:
- Key insights or surprising statements
- Emotional peaks (high energy + impactful words)
- Complete thoughts that stand alone as clips
- Natural start/end points (sentence boundaries)

Respond ONLY with valid JSON in this exact format:
{"highlights":[{"start":0,"end":0,"score":0,"title":"","reason":""}]}

Where start/end are seconds, score is 1-10, title is a short description, reason explains why it's engaging.`;

    const response = await c.env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2048,
    });

    let responseText = '';
    if (typeof response === 'string') {
      responseText = response;
    } else if (response && typeof response === 'object') {
      const resp = response as Record<string, unknown>;
      if (typeof resp.response === 'string') {
        responseText = resp.response;
      } else {
        responseText = JSON.stringify(response);
      }
    }

    if (!responseText) {
      return c.json({ error: 'Empty AI response' }, 500);
    }

    type Highlight = { start: number; end: number; score: number; title: string; reason: string };
    let highlights: Highlight[] = [];

    try {
      const outer = JSON.parse(responseText);
      if (Array.isArray(outer.highlights)) {
        highlights = outer.highlights;
      } else if (outer.response && Array.isArray(outer.response.highlights)) {
        highlights = outer.response.highlights;
      }
    } catch {
      const jsonMatch = responseText.match(/\{[\s\S]*"highlights"[\s\S]*\}/);
      if (!jsonMatch) {
        return c.json({ error: 'Failed to parse AI response', raw: responseText.slice(0, 500) }, 500);
      }
      const parsed = JSON.parse(jsonMatch[0]);
      highlights = parsed.highlights || parsed.response?.highlights || [];
    }

    if (!Array.isArray(highlights) || highlights.length === 0) {
      return c.json({ error: 'No highlights found in AI response' }, 500);
    }

    const validated = highlights
      .filter((h) => h.start >= 0 && h.end > h.start && h.end <= body.duration)
      .map((h) => ({
        start: Math.max(0, h.start),
        end: Math.min(body.duration, h.end),
        score: Math.min(10, Math.max(1, Math.round(h.score))),
        title: h.title || 'Highlight',
        reason: h.reason || '',
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, targetCount);

    return c.json({ highlights: validated });
  } catch (error) {
    console.error('Highlights error:', error);
    return c.json({ error: 'Failed to generate highlights', detail: error instanceof Error ? error.message : String(error) }, 500);
  }
});

app.get('/health', (c) => {
  return c.json({ status: 'healthy', timestamp: Date.now() });
});

export default app;
