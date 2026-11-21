import React, { useEffect, useId, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  ImagePlus,
  Loader2,
  Move,
  RotateCcw,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

const CROP_VIEWPORT_PX = 256;
const MINI_PREVIEW_PX = 64;
const EXPORT_SIZE_PX = 512;
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const ALLOWED_EXTENSIONS_RE = /\.(png|jpe?g|webp)$/i;

function computeCropGeometry(naturalWidth: number, naturalHeight: number, zoom: number) {
  if (!naturalWidth || !naturalHeight) {
    return {
      dispW: CROP_VIEWPORT_PX,
      dispH: CROP_VIEWPORT_PX,
      maxX: 0,
      maxY: 0,
    };
  }
  const baseScale = Math.max(CROP_VIEWPORT_PX / naturalWidth, CROP_VIEWPORT_PX / naturalHeight);
  const dispW = naturalWidth * baseScale * zoom;
  const dispH = naturalHeight * baseScale * zoom;
  const maxX = Math.max(0, (dispW - CROP_VIEWPORT_PX) / 2);
  const maxY = Math.max(0, (dispH - CROP_VIEWPORT_PX) / 2);
  return { dispW, dispH, maxX, maxY };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function AvatarEditorModal({
  open,
  hasExistingAvatar,
  onClose,
  onSave,
}: {
  open: boolean;
  hasExistingAvatar: boolean;
  onClose: () => void;
  onSave: (croppedBlob: Blob, filename: string) => Promise<void>;
}) {
  const titleId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origOffsetX: number;
    origOffsetY: number;
  } | null>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [naturalDims, setNaturalDims] = useState<{ width: number; height: number } | null>(null);
  const [zoom, setZoom] = useState<number>(1);
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // Clean up object URL when modal closes or file changes
  useEffect(() => {
    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [objectUrl]);

  // Reset modal state whenever opened/closed
  useEffect(() => {
    if (!open) {
      setSelectedFile(null);
      setObjectUrl(null);
      setNaturalDims(null);
      setZoom(1);
      setOffset({ x: 0, y: 0 });
      setError('');
      setSaving(false);
      setIsDraggingFile(false);
      setIsPanning(false);
      imgRef.current = null;
      return;
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !saving) {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, saving, onClose]);

  if (!open) {
    return null;
  }

  function handleSelectFile(file: File | null | undefined) {
    if (!file) return;
    setError('');

    const nameOk = ALLOWED_EXTENSIONS_RE.test(file.name);
    const mimeOk = !file.type || ALLOWED_MIME_TYPES.has(file.type.toLowerCase());
    if (!nameOk || !mimeOk || file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)) {
      setError('Please select a PNG, JPEG, or WebP image file. SVG and non-image files are not allowed.');
      return;
    }

    if (file.size === 0) {
      setError('The selected file is empty. Please choose a valid image.');
      return;
    }

    if (file.size > MAX_AVATAR_BYTES) {
      setError('Profile picture must be 5 MB or smaller.');
      return;
    }

    const nextUrl = URL.createObjectURL(file);
    setSelectedFile(file);
    setObjectUrl(nextUrl);
    setNaturalDims(null);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }

  function handleImageLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const target = e.currentTarget;
    imgRef.current = target;
    setNaturalDims({
      width: target.naturalWidth,
      height: target.naturalHeight,
    });
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }

  function handleImageError() {
    setError('Unable to decode this image file. Please try another PNG, JPEG, or WebP image.');
    setSelectedFile(null);
    setObjectUrl(null);
    setNaturalDims(null);
    imgRef.current = null;
  }

  const geometry = computeCropGeometry(
    naturalDims?.width ?? 0,
    naturalDims?.height ?? 0,
    zoom
  );

  function updateZoom(nextZoomRaw: number) {
    const nextZoom = clamp(Number(nextZoomRaw.toFixed(2)), 1, 3);
    setZoom(nextZoom);
    if (naturalDims) {
      const nextGeom = computeCropGeometry(naturalDims.width, naturalDims.height, nextZoom);
      setOffset((prev) => ({
        x: clamp(prev.x, -nextGeom.maxX, nextGeom.maxX),
        y: clamp(prev.y, -nextGeom.maxY, nextGeom.maxY),
      }));
    }
  }

  function handleReset() {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setError('');
  }

  function handleCropPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!naturalDims || saving) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStateRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origOffsetX: offset.x,
      origOffsetY: offset.y,
    };
    setIsPanning(true);
  }

  function handleCropPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== e.pointerId || !naturalDims) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    setOffset({
      x: clamp(drag.origOffsetX + dx, -geometry.maxX, geometry.maxX),
      y: clamp(drag.origOffsetY + dy, -geometry.maxY, geometry.maxY),
    });
  }

  function handleCropPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (dragStateRef.current?.pointerId === e.pointerId) {
      dragStateRef.current = null;
      setIsPanning(false);
    }
  }

  function handleCropKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!naturalDims || saving) return;
    const step = e.shiftKey ? 16 : 6;
    let dx = 0;
    let dy = 0;
    if (e.key === 'ArrowLeft') dx = -step;
    else if (e.key === 'ArrowRight') dx = step;
    else if (e.key === 'ArrowUp') dy = -step;
    else if (e.key === 'ArrowDown') dy = step;
    else if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      updateZoom(zoom + 0.15);
      return;
    } else if (e.key === '-' || e.key === '_') {
      e.preventDefault();
      updateZoom(zoom - 0.15);
      return;
    } else {
      return;
    }

    e.preventDefault();
    setOffset((prev) => ({
      x: clamp(prev.x + dx, -geometry.maxX, geometry.maxX),
      y: clamp(prev.y + dy, -geometry.maxY, geometry.maxY),
    }));
  }

  async function handleSaveCropped() {
    if (!imgRef.current || !naturalDims || !selectedFile) return;
    setError('');
    setSaving(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = EXPORT_SIZE_PX;
      canvas.height = EXPORT_SIZE_PX;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Canvas image processing is unavailable in this browser.');
      }

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.clearRect(0, 0, EXPORT_SIZE_PX, EXPORT_SIZE_PX);

      const scaleFactor = EXPORT_SIZE_PX / CROP_VIEWPORT_PX;
      const drawX = (CROP_VIEWPORT_PX / 2 - geometry.dispW / 2 + offset.x) * scaleFactor;
      const drawY = (CROP_VIEWPORT_PX / 2 - geometry.dispH / 2 + offset.y) * scaleFactor;
      const drawW = geometry.dispW * scaleFactor;
      const drawH = geometry.dispH * scaleFactor;

      ctx.drawImage(imgRef.current, drawX, drawY, drawW, drawH);

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (result) => {
            if (result) resolve(result);
            else reject(new Error('Failed to export cropped profile picture.'));
          },
          'image/png',
          0.95
        );
      });

      const rawStem = selectedFile.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '-');
      const uploadName = `${rawStem || 'avatar'}.png`;
      await onSave(blob, uploadName);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save profile picture.');
    } finally {
      setSaving(false);
    }
  }

  const miniScale = MINI_PREVIEW_PX / CROP_VIEWPORT_PX;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
      onClick={() => {
        if (!saving) onClose();
      }}
    >
      <div
        className="clay-surface rounded-[30px] w-full max-w-lg p-6 sm:p-7 space-y-5 my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="text-[11px] font-bold uppercase tracking-wider text-indigo-600 dark:text-violet-300">
              Profile Picture Editor
            </p>
            <h3 id={titleId} className="text-xl font-extrabold tracking-tight text-slate-900 dark:text-white">
              {hasExistingAvatar ? 'Update Profile Picture' : 'Upload Profile Picture'}
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-300">
              Choose a PNG, JPEG, or WebP photo (max 5 MB), then pan and zoom inside the circular frame.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close profile picture editor"
            className="clay-btn-secondary rounded-full w-9 h-9 inline-flex items-center justify-center shrink-0 cursor-pointer disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            handleSelectFile(file);
          }}
        />

        {error && (
          <div
            role="alert"
            className="rounded-2xl px-4 py-3 text-xs font-semibold bg-red-50 text-red-800 border border-red-200 dark:bg-rose-500/15 dark:text-rose-200 dark:border-rose-400/30 flex items-start gap-2.5"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {!objectUrl ? (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDraggingFile(true);
            }}
            onDragLeave={() => setIsDraggingFile(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDraggingFile(false);
              handleSelectFile(e.dataTransfer.files?.[0]);
            }}
            onClick={() => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            className={`clay-well rounded-[24px] p-8 border-2 border-dashed transition-colors text-center flex flex-col items-center justify-center gap-3 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:focus-visible:ring-violet-400 ${
              isDraggingFile
                ? 'border-indigo-500 bg-indigo-50/70 dark:border-violet-400 dark:bg-violet-900/30'
                : 'border-indigo-200/90 dark:border-violet-400/30 hover:border-indigo-400 dark:hover:border-violet-300'
            }`}
          >
            <div className="w-14 h-14 rounded-2xl bg-indigo-100/90 dark:bg-violet-500/20 text-indigo-600 dark:text-violet-300 flex items-center justify-center">
              <ImagePlus className="w-7 h-7" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-bold text-slate-900 dark:text-white">
                Click to select or drag a photo here
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Supports PNG, JPEG, and WebP up to 5 MB
              </p>
            </div>
            <span className="clay-btn-primary rounded-full px-5 py-2 text-xs font-bold inline-flex items-center gap-2 mt-1">
              <Upload className="w-3.5 h-3.5" />
              Select Photo
            </span>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Crop Canvas + Live Circular Preview */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-5">
              <div className="space-y-2 flex flex-col items-center">
                <div
                  role="application"
                  aria-label="Circular avatar crop area. Drag or use arrow keys to reposition."
                  tabIndex={0}
                  onPointerDown={handleCropPointerDown}
                  onPointerMove={handleCropPointerMove}
                  onPointerUp={handleCropPointerUp}
                  onPointerCancel={handleCropPointerUp}
                  onKeyDown={handleCropKeyDown}
                  onWheel={(e) => {
                    if (!naturalDims || saving) return;
                    e.preventDefault();
                    updateZoom(zoom + (e.deltaY < 0 ? 0.1 : -0.1));
                  }}
                  style={{ width: `${CROP_VIEWPORT_PX}px`, height: `${CROP_VIEWPORT_PX}px` }}
                  className={`relative overflow-hidden rounded-3xl bg-slate-900/90 select-none touch-none border border-indigo-200/80 dark:border-violet-400/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:focus-visible:ring-violet-400 ${
                    isPanning ? 'cursor-grabbing' : 'cursor-grab'
                  }`}
                >
                  <img
                    src={objectUrl}
                    alt="Selected profile picture"
                    draggable={false}
                    onLoad={handleImageLoad}
                    onError={handleImageError}
                    style={
                      naturalDims
                        ? {
                            width: `${geometry.dispW}px`,
                            height: `${geometry.dispH}px`,
                            left: `${CROP_VIEWPORT_PX / 2 - geometry.dispW / 2 + offset.x}px`,
                            top: `${CROP_VIEWPORT_PX / 2 - geometry.dispH / 2 + offset.y}px`,
                          }
                        : { opacity: 0 }
                    }
                    className="absolute max-w-none select-none pointer-events-none"
                  />

                  {/* Circular aperture vignette */}
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 rounded-full"
                    style={{
                      boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.58)',
                    }}
                  />
                  {/* Crisp circular crop ring */}
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-white/90"
                  />
                </div>
                <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 inline-flex items-center gap-1.5">
                  <Move className="w-3 h-3" />
                  Drag or use arrow keys to reposition
                </p>
              </div>

              {/* Exact circular result preview */}
              {naturalDims && (
                <div className="clay-well rounded-2xl p-4 flex sm:flex-col items-center gap-3 shrink-0">
                  <div
                    style={{ width: `${MINI_PREVIEW_PX}px`, height: `${MINI_PREVIEW_PX}px` }}
                    className="relative overflow-hidden rounded-full border-2 border-white dark:border-violet-300/40 shadow-sm bg-slate-900 shrink-0"
                  >
                    <img
                      src={objectUrl}
                      alt="Final circular preview"
                      draggable={false}
                      style={{
                        width: `${geometry.dispW * miniScale}px`,
                        height: `${geometry.dispH * miniScale}px`,
                        left: `${(CROP_VIEWPORT_PX / 2 - geometry.dispW / 2 + offset.x) * miniScale}px`,
                        top: `${(CROP_VIEWPORT_PX / 2 - geometry.dispH / 2 + offset.y) * miniScale}px`,
                      }}
                      className="absolute max-w-none select-none pointer-events-none"
                    />
                  </div>
                  <div className="text-left sm:text-center space-y-0.5">
                    <p className="text-[11px] font-bold text-slate-800 dark:text-slate-100">
                      Circular Preview
                    </p>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400">
                      512 × 512 px
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Zoom & Reset Controls */}
            <div className="clay-well rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-bold text-slate-700 dark:text-slate-200">
                  Zoom ({zoom.toFixed(2)}×)
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleReset}
                    disabled={saving}
                    className="text-xs font-bold text-indigo-600 dark:text-violet-300 hover:underline inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Reset
                  </button>
                  <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">|</span>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={saving}
                    className="text-xs font-bold text-indigo-600 dark:text-violet-300 hover:underline cursor-pointer disabled:opacity-50"
                  >
                    Choose Another
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  aria-label="Zoom out"
                  onClick={() => updateZoom(zoom - 0.15)}
                  disabled={saving || zoom <= 1}
                  className="clay-btn-secondary rounded-full w-8 h-8 inline-flex items-center justify-center shrink-0 cursor-pointer disabled:opacity-45"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <input
                  type="range"
                  aria-label="Zoom level"
                  min={1}
                  max={3}
                  step={0.02}
                  value={zoom}
                  disabled={saving || !naturalDims}
                  onChange={(e) => updateZoom(Number(e.target.value))}
                  className="flex-1 accent-indigo-600 dark:accent-violet-400 cursor-pointer"
                />
                <button
                  type="button"
                  aria-label="Zoom in"
                  onClick={() => updateZoom(zoom + 0.15)}
                  disabled={saving || zoom >= 3}
                  className="clay-btn-secondary rounded-full w-8 h-8 inline-flex items-center justify-center shrink-0 cursor-pointer disabled:opacity-45"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex flex-wrap items-center justify-end gap-2.5 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="clay-btn-secondary rounded-full px-5 py-2.5 text-xs font-bold cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          {objectUrl && (
            <button
              type="button"
              onClick={handleSaveCropped}
              disabled={saving || !naturalDims}
              className="clay-btn-primary rounded-full px-5 py-2.5 text-xs font-bold inline-flex items-center gap-2 cursor-pointer disabled:opacity-60"
            >
              {saving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Saving Picture...
                </>
              ) : (
                <>
                  <Check className="w-3.5 h-3.5" />
                  Save Cropped Picture
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
