import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  ToggleGroup,
  ToggleGroupItem,
} from "@openreel/ui";
import {
  SOCIAL_MEDIA_CATEGORY_INFO,
  type SocialMediaCategory,
} from "@openreel/core";
import {
  Smartphone,
  Monitor,
  Square,
  Play,
  Star,
  Layers,
  Briefcase,
  Bookmark,
  AtSign,
  Users,
  Type,
  Settings,
  LayoutGrid,
} from "@/icons/lucide-compat";

interface Props {
  selectedCategory: SocialMediaCategory | "all";
  onSelectCategory: (category: SocialMediaCategory | "all") => void;
  categoryStats: Record<string, number>;
}
const icons: Record<string, React.ElementType> = {
  tiktok: Smartphone,
  "instagram-reels": Smartphone,
  "instagram-stories": Smartphone,
  "instagram-post": Square,
  "youtube-shorts": Smartphone,
  "youtube-video": Monitor,
  facebook: Users,
  twitter: AtSign,
  linkedin: Briefcase,
  pinterest: Bookmark,
  intro: Play,
  outro: Play,
  promo: Star,
  "lower-third": Type,
  slideshow: Layers,
  custom: Settings,
};
const platforms: { name: string; categories: SocialMediaCategory[] }[] = [
  { name: "TikTok", categories: ["tiktok"] },
  {
    name: "Instagram",
    categories: ["instagram-reels", "instagram-stories", "instagram-post"],
  },
  { name: "YouTube", categories: ["youtube-shorts", "youtube-video"] },
  { name: "Facebook", categories: ["facebook"] },
  { name: "Twitter/X", categories: ["twitter"] },
  { name: "LinkedIn", categories: ["linkedin"] },
  { name: "Pinterest", categories: ["pinterest"] },
  {
    name: "General",
    categories: [
      "intro",
      "outro",
      "promo",
      "lower-third",
      "slideshow",
      "custom",
    ],
  },
];
const platformClass =
  "h-9 gap-2 rounded-lg border border-border bg-bg-2 px-4 text-sm text-fg-2 data-[state=active]:bg-primary data-[state=active]:text-black [&>.absolute]:rounded-lg [&>.absolute]:bg-primary [&>.absolute]:shadow-none";
export function CategoryTabs({
  selectedCategory,
  onSelectCategory,
  categoryStats,
}: Props) {
  const selectedPlatform =
    selectedCategory === "all"
      ? "all"
      : (platforms.find((platform) =>
          platform.categories.includes(selectedCategory),
        )?.name ?? "all");
  // A platform with no template (and not the one being viewed) is not offered: it would lead to an empty page.
  const populated = platforms.filter(
    (platform) => platform.name === selectedPlatform || platform.categories.some((category) => categoryStats[category]),
  );
  return (
    <Tabs
      value={selectedPlatform}
      onValueChange={(value) => {
        if (value === "all") onSelectCategory("all");
        else {
          const platform = platforms.find((item) => item.name === value);
          if (platform)
            onSelectCategory(
              platform.categories.includes(
                selectedCategory as SocialMediaCategory,
              )
                ? selectedCategory
                : platform.categories[0],
            );
        }
      }}
      className="min-w-0 space-y-3"
    >
      <div className="max-w-full overflow-x-auto pb-1">
        <TabsList
          aria-label="Template platforms"
          layoutId="template-platforms"
          className="h-auto min-w-max justify-start gap-2 rounded-none bg-transparent p-0"
        >
          <TabsTrigger value="all" className={platformClass}>
            <LayoutGrid size={14} aria-hidden />
            All
            <span className="text-xs opacity-60">{categoryStats.all ?? 0}</span>
          </TabsTrigger>
          {populated.map((platform) => {
            const Icon = icons[platform.categories[0]],
              count = platform.categories.reduce(
                (sum, category) => sum + (categoryStats[category] ?? 0),
                0,
              );
            return (
              <TabsTrigger
                key={platform.name}
                value={platform.name}
                className={platformClass}
              >
                <Icon size={14} aria-hidden />
                {platform.name}
                {count > 0 && (
                  <span className="text-xs opacity-60">{count}</span>
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </div>
      <TabsContent value="all" className="m-0" />
      {populated.map((platform) => (
        <TabsContent
          key={platform.name}
          value={platform.name}
          className="m-0 min-w-0"
        >
          {platform.categories.length > 1 && (
            <div className="overflow-x-auto pb-1">
              <ToggleGroup
                type="single"
                aria-label={`${platform.name} template categories`}
                value={selectedCategory}
                onValueChange={(value) => {
                  if (value) onSelectCategory(value as SocialMediaCategory);
                }}
                className="min-w-max justify-start gap-2 pl-2"
              >
                {platform.categories.map((category) => {
                  const info = SOCIAL_MEDIA_CATEGORY_INFO.find(
                      (item) => item.id === category,
                    ),
                    Icon = icons[category],
                    count = categoryStats[category] ?? 0;
                  return (
                    <ToggleGroupItem
                      key={category}
                      value={category}
                      className="h-8 gap-2 rounded-md border border-border bg-bg-1 px-3 text-xs text-fg-3 data-[state=on]:border-primary/30 data-[state=on]:bg-primary/20 data-[state=on]:text-primary"
                    >
                      <Icon size={12} aria-hidden />
                      {info?.name ?? category}
                      {count > 0 && (
                        <span className="text-[10px] opacity-70">{count}</span>
                      )}
                    </ToggleGroupItem>
                  );
                })}
              </ToggleGroup>
            </div>
          )}
        </TabsContent>
      ))}
    </Tabs>
  );
}
