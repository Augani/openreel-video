import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";

export const RecordingCountdown: React.FC = () => {
  const { t } = useTranslation();
  const [count, setCount] = useState(3);

  useEffect(() => {
    if (count > 0) {
      const timer = setTimeout(() => setCount(count - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [count]);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90 backdrop-blur-md">
      <div className="relative">
        <div
          key={count}
          className="text-[180px] font-bold text-white animate-countdown"
          style={{
            textShadow:
              "0 0 60px rgba(239, 68, 68, 0.8), 0 0 100px rgba(239, 68, 68, 0.4)",
          }}
        >
          {count > 0 ? count : ""}
        </div>

        {count === 0 && (
          <div className="flex flex-col items-center gap-4 animate-fade-in">
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 bg-error rounded-full animate-pulse" />
              <span className="text-2xl font-bold text-white">
                {t("recording.recording")}
              </span>
            </div>
          </div>
        )}
      </div>

      <style>{`
 @keyframes countdown {
 0% {
 transform: scale(0.5);
 opacity: 0;
 }
 20% {
 transform: scale(1.2);
 opacity: 1;
 }
 40% {
 transform: scale(1);
 }
 100% {
 transform: scale(0.8);
 opacity: 0;
 }
 }

 @keyframes fade-in {
 from {
 opacity: 0;
 transform: translateY(20px);
 }
 to {
 opacity: 1;
 transform: translateY(0);
 }
 }

 .animate-countdown {
 animation: countdown 1s ease-out forwards;
 }

 .animate-fade-in {
 animation: fade-in 0.5s ease-out forwards;
 }
 `}</style>
    </div>
  );
};
