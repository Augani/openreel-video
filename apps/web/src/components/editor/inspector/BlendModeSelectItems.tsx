import React from "react";
import { SelectGroup, SelectItem, SelectLabel } from "@openreel/ui";
import { BLEND_MODE_GROUPS, getBlendModeName } from "@openreel/core";

/** Blend mode menu entries grouped like Premiere: Normal, Darken, Lighten, Contrast, Inversion, Component. */
export const BlendModeSelectItems: React.FC = () => (
  <>
    {BLEND_MODE_GROUPS.map((group) => (
      <SelectGroup key={group.label}>
        <SelectLabel>{group.label}</SelectLabel>
        {group.modes.map((mode) => (
          <SelectItem key={mode} value={mode}>
            {getBlendModeName(mode)}
          </SelectItem>
        ))}
      </SelectGroup>
    ))}
  </>
);
