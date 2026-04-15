import { useState, useRef, useCallback, useEffect } from "react";
import { Play, Pause } from "lucide-react";

interface AudioPlayerProps {
  src: string;
  direction?: "incoming" | "outgoing" | string;
  className?: string;
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const SPEEDS = [1, 1.5, 2];

export function AudioPlayer({ src, direction, className = "" }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const progressRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onLoaded = () => setDuration(audio.duration);
    const onTimeUpdate = () => {
      if (!isDragging) setCurrentTime(audio.currentTime);
    };
    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("durationchange", onLoaded);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("ended", onEnded);

    return () => {
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("durationchange", onLoaded);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("ended", onEnded);
    };
  }, [isDragging]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.play().catch(() => {});
      setIsPlaying(true);
    }
  }, [isPlaying]);

  const cycleSpeed = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const idx = SPEEDS.indexOf(speed);
    const next = SPEEDS[(idx + 1) % SPEEDS.length];
    audio.playbackRate = next;
    setSpeed(next);
  }, [speed]);

  const seekTo = useCallback((clientX: number) => {
    const bar = progressRef.current;
    const audio = audioRef.current;
    if (!bar || !audio || !duration) return;
    const rect = bar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const newTime = pct * duration;
    audio.currentTime = newTime;
    setCurrentTime(newTime);
  }, [duration]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setIsDragging(true);
    seekTo(e.clientX);
    const onMove = (ev: MouseEvent) => seekTo(ev.clientX);
    const onUp = () => {
      setIsDragging(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [seekTo]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    setIsDragging(true);
    seekTo(e.touches[0].clientX);
  }, [seekTo]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    seekTo(e.touches[0].clientX);
  }, [seekTo]);

  const handleTouchEnd = useCallback(() => {
    setIsDragging(false);
  }, []);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const isOut = direction === "outgoing";
  const accentColor = isOut ? "#7c57d1" : "#00a884";

  return (
    <div className={`flex items-center gap-2 min-w-[200px] max-w-[280px] ${className}`}>
      <audio ref={audioRef} src={src} preload="metadata" />

      {/* Play/Pause */}
      <button
        onClick={togglePlay}
        className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-colors"
        style={{ backgroundColor: accentColor }}
      >
        {isPlaying ? (
          <Pause className="h-4 w-4 text-white fill-white" />
        ) : (
          <Play className="h-4 w-4 text-white fill-white ml-0.5" />
        )}
      </button>

      {/* Progress + time */}
      <div className="flex-1 flex flex-col gap-0.5 min-w-0">
        <div
          ref={progressRef}
          className="h-[6px] rounded-full bg-black/15 cursor-pointer relative"
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div
            className="absolute top-0 left-0 h-full rounded-full transition-[width] duration-100"
            style={{ width: `${progress}%`, backgroundColor: accentColor }}
          />
          <div
            className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-white shadow-sm"
            style={{
              left: `calc(${progress}% - 6px)`,
              backgroundColor: accentColor,
            }}
          />
        </div>
        <div className="flex justify-between text-[10px] text-[#8696a0] leading-none">
          <span>{formatTime(isPlaying || currentTime > 0 ? currentTime : duration)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      {/* Speed */}
      <button
        onClick={cycleSpeed}
        className="flex-shrink-0 w-8 h-5 rounded-full bg-black/10 text-[10px] font-bold flex items-center justify-center"
        style={{ color: accentColor }}
      >
        {speed}x
      </button>
    </div>
  );
}
