import { BUILT_IN_EDITING_TEMPLATES } from "./built-in-templates";
import type { EditingTemplate, EditingTemplateCategory } from "./types";

const builtInTemplateMap = new Map(
  BUILT_IN_EDITING_TEMPLATES.map((template) => [template.id, template]),
);

export function getBuiltInEditingTemplates(): readonly EditingTemplate[] {
  return BUILT_IN_EDITING_TEMPLATES;
}

export function getBuiltInEditingTemplate(
  templateId: string,
): EditingTemplate | undefined {
  return builtInTemplateMap.get(templateId);
}

export function getBuiltInEditingTemplatesByCategory(
  category: EditingTemplateCategory,
): readonly EditingTemplate[] {
  return BUILT_IN_EDITING_TEMPLATES.filter(
    (template) => template.category === category,
  );
}