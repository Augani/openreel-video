export interface ElevenLabsModel {
  model_id: string;
  name: string;
  description?: string;
  can_do_text_to_speech?: boolean;
  languages?: Array<{ language_id: string; name: string }>;
}

export interface Voice {
  id: string;
  name: string;
  gender: "male" | "female";
  language: string;
}

export interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category: string;
  labels: Record<string, string>;
  preview_url?: string;
}
