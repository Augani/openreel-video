# OpenReel Cloud API

Cloudflare Worker API for OpenReel template storage and sharing.

## Features

- **Template Storage**: Upload and store templates in Cloudflare R2
- **Template Listing**: Browse all available templates
- **Template Download**: Download individual templates
- **Template Deletion**: Delete custom templates (built-ins protected)

## Setup

### 1. Create R2 Bucket

```bash
cd apps/cloud
npx wrangler r2 bucket create openreel-templates
```

### 2. Deploy Worker

```bash
npm run deploy
```

The worker will be deployed to: `https://openreel-cloud.<your-subdomain>.workers.dev`

## API Endpoints

### GET `/`
Get API information and available endpoints.

**Response:**
```json
{
  "name": "OpenReel Cloud API",
  "version": "1.0.0",
  "endpoints": {
    "templates": {
      "list": "GET /templates",
      "get": "GET /templates/:id",
      "upload": "POST /templates",
      "delete": "DELETE /templates/:id"
    }
  }
}
```

### GET `/templates`
List all templates.

**Query Parameters:**
- `cursor` (optional): Pagination cursor

**Response:**
```json
{
  "templates": [
    {
      "id": "template-123",
      "name": "My Template",
      "category": "youtube",
      "description": "A cool template",
      "thumbnailUrl": null,
      "placeholderCount": 2,
      "duration": 30,
      "createdAt": 1234567890,
      "tags": ["intro", "animated"],
      "author": "username"
    }
  ],
  "cursor": "next-page-token",
  "truncated": false
}
```

### GET `/templates/:id`
Get a specific template by ID.

**Response:**
```json
{
  "id": "template-123",
  "name": "My Template",
  "description": "A cool template",
  "category": "youtube",
  "settings": {
    "width": 1920,
    "height": 1080,
    "frameRate": 30
  },
  "timeline": {
    "tracks": [...],
    "graphics": {...}
  },
  "placeholders": [...]
}
```

### POST `/templates`
Upload a new template.

**Request Body:**
```json
{
  "id": "template-123",
  "name": "My Template",
  "description": "Description",
  "category": "youtube",
  "timeline": {...},
  "placeholders": [...],
  "tags": ["intro"],
  "author": "username"
}
```

**Response:**
```json
{
  "success": true,
  "id": "template-123",
  "message": "Template uploaded successfully"
}
```

### DELETE `/templates/:id`
Delete a template.

**Response:**
```json
{
  "success": true,
  "message": "Template deleted successfully"
}
```

### GET `/health`
Health check endpoint.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": 1234567890
}
```

## R2 Configuration

The worker uses Cloudflare R2 for storage with the following configuration:

- **Bucket Name**: `openreel-templates`
- **Binding**: `TEMPLATES_BUCKET`
- **Access**: Via Cloudflare Workers R2 API (no direct S3 access needed)

## CORS

CORS is configured to allow requests from:
- `http://localhost:5173` (local development)
- `https://app.openreel.video` (production)
- `https://*.openreel-3pq.pages.dev` (Cloudflare Pages previews)

## Local Development

```bash
npm run dev
```

The worker will be available at `http://localhost:8787`

## Environment Variables

Set in `wrangler.jsonc`:
- `ENVIRONMENT`: `production` or `development`

## Security Notes

- Built-in templates (IDs starting with `builtin-`) cannot be deleted
- Template IDs must be unique
- All uploads are validated for required fields (id, name, timeline)
- CORS is restricted to OpenReel domains only
