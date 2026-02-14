import { useState } from "react";
import { cn } from "@/lib/utils";

interface BrandLogoProps {
  containerClassName?: string;
  imageClassName?: string;
  alt?: string;
}

export function BrandLogo({
  containerClassName,
  imageClassName,
  alt = "AMEN",
}: BrandLogoProps) {
  const [src, setSrc] = useState("/icons/icon-192.png");

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl bg-white/15 border border-white/25 flex items-center justify-center",
        containerClassName,
      )}
    >
      {src ? (
        <img
          src={src}
          alt={alt}
          className={cn("h-full w-full object-cover", imageClassName)}
          onError={() => setSrc("")}
        />
      ) : (
        <span className="text-xs font-bold tracking-wide text-white">AM</span>
      )}
    </div>
  );
}
