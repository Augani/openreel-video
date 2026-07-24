import { useEffect, useState } from "react";
import { Monitor } from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";

export function MobileBlocker() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      const userAgent = navigator.userAgent.toLowerCase();
      const mobileKeywords =
        /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini|mobile|tablet/i;
      const isMobileDevice = mobileKeywords.test(userAgent);
      const isSmallScreen = window.innerWidth < 768;
      setIsMobile(isMobileDevice || isSmallScreen);
    };

    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  if (!isMobile) return null;

  return (
    <div className="fixed inset-0 z-[9999] bg-background flex items-center justify-center p-6">
      <div className="max-w-md text-center space-y-8">
        <div className="flex justify-center">
          <div className="bg-background-secondary border-2 border-primary/30 rounded-2xl p-8 shadow-glow-lg">
            <Monitor className="w-20 h-20 text-primary" strokeWidth={1.5} />
          </div>
        </div>

        <div className="space-y-3">
          <Text type="body" color="primary" weight="bold" className="text-5xl text-text-primary tracking-tight">
            OpenReel
          </Text>
          <div className="flex items-center justify-center gap-2">
            <div className="h-px w-8 bg-primary/50" />
            <Text type="supporting" color="secondary" weight="medium" className="text-lg text-text-secondary">
              Desktop Only
            </Text>
            <div className="h-px w-8 bg-primary/50" />
          </div>
        </div>

        <div className="space-y-4 bg-background-secondary/50 backdrop-blur-sm rounded-xl p-6 border border-border">
          <Text
            type="supporting"
            color="primary"
            display="block"
            className="text-base text-text-primary leading-relaxed"
          >
            OpenReel is a professional video editor that requires a desktop or
            laptop computer.
          </Text>
          <Text
            type="supporting"
            color="secondary"
            display="block"
            className="text-sm text-text-muted"
          >
            Please visit this page on your desktop or laptop to start creating
            amazing videos.
          </Text>
        </div>

        <div className="pt-2">
          <Button
            as="a"
            label="Learn More"
            href="https://openreel.video"
            className="inline-flex items-center gap-2 px-8 py-3 bg-primary hover:bg-primary-hover active:bg-primary-active text-white font-medium rounded-lg transition-all duration-200 shadow-glow hover:shadow-glow-lg transform hover:scale-[1.02] active:scale-[0.98]"
          />
        </div>
      </div>
    </div>
  );
}
