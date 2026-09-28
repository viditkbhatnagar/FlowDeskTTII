import { useId, useState } from "react";
import Cropper, { type Area, type Point } from "react-easy-crop";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { Loader2, RotateCcw, RotateCw, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AVATAR_ZOOM, normalizeRotation, type CropArea } from "@/lib/avatar-photo";

const clampZoom = (zoom: number) => Math.min(AVATAR_ZOOM.max, Math.max(AVATAR_ZOOM.min, zoom));

export interface AvatarCropDialogProps {
  /** The opened photo (an object URL). The dialog is open while this is set. */
  imageUrl: string | null;
  /** True while the parent renders and stores the crop: Save shows a spinner and nothing closes. */
  saving: boolean;
  onCancel: () => void;
  onSave: (area: CropArea, rotation: number) => void;
  /**
   * Once the dialog has closed (saved or cancelled): put keyboard focus back
   * where it belongs. Without it Radix returns focus to whatever had it when
   * the dialog opened, which is nothing: the picker's button is disabled
   * while the file is being read, and a disabled button loses focus.
   */
  onClosed?: () => void;
}

/**
 * Position a photo in a round frame: drag it (or use the arrow keys), zoom
 * 1×–3× with the slider, the buttons or the mouse wheel, and turn it a quarter
 * at a time. What is inside the circle is what colleagues will see.
 */
export function AvatarCropDialog({
  imageUrl,
  saving,
  onCancel,
  onSave,
  onClosed,
}: AvatarCropDialogProps) {
  // The last photo stays in place while the dialog fades out, instead of the
  // dialog emptying first.
  const [shownUrl, setShownUrl] = useState(imageUrl);
  if (imageUrl && imageUrl !== shownUrl) setShownUrl(imageUrl);

  return (
    <Dialog
      open={Boolean(imageUrl)}
      onOpenChange={(open) => {
        if (!open && !saving) onCancel();
      }}
    >
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] max-w-md gap-5 overflow-y-auto"
        // Escape and a click outside must not drop a photo that is being saved.
        onEscapeKeyDown={(event) => saving && event.preventDefault()}
        onInteractOutside={(event) => saving && event.preventDefault()}
        onCloseAutoFocus={(event) => {
          if (!onClosed) return;
          event.preventDefault();
          onClosed();
        }}
      >
        {/* Keyed by the photo, so each one starts centred at 1× and upright. */}
        {shownUrl && (
          <CropEditor
            key={shownUrl}
            imageUrl={shownUrl}
            saving={saving}
            onCancel={onCancel}
            onSave={onSave}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CropEditor({
  imageUrl,
  saving,
  onCancel,
  onSave,
}: Omit<AvatarCropDialogProps, "imageUrl"> & { imageUrl: string }) {
  const hintId = useId();
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState<number>(AVATAR_ZOOM.min);
  const [rotation, setRotation] = useState(0);
  const [area, setArea] = useState<Area | null>(null);

  const rotate = (by: number) => setRotation((current) => normalizeRotation(current + by));
  // "1.25×", "1.5×", "2.0×": two decimals only where the buttons put them.
  const zoomLabel = `${zoom.toFixed(2).replace(/(\.\d)0$/, "$1")}×`;

  return (
    <>
      <DialogHeader className="pr-10">
        <DialogTitle>Adjust photo</DialogTitle>
        <DialogDescription id={hintId}>
          Drag the photo, or use the arrow keys, to position it in the circle.
        </DialogDescription>
      </DialogHeader>

      <div className="relative h-72 w-full overflow-hidden rounded-xl bg-muted sm:h-80">
        <Cropper
          image={imageUrl}
          crop={crop}
          zoom={zoom}
          rotation={rotation}
          aspect={1}
          minZoom={AVATAR_ZOOM.min}
          maxZoom={AVATAR_ZOOM.max}
          cropShape="round"
          showGrid={false}
          onCropChange={setCrop}
          onZoomChange={(next) => setZoom(clampZoom(next))}
          onRotationChange={(next) => setRotation(normalizeRotation(next))}
          onCropComplete={(_, pixels) => setArea(pixels)}
          // The crop circle is the focusable part; the arrow keys move the photo.
          cropperProps={{
            role: "group",
            "aria-label": "Photo position",
            "aria-describedby": hintId,
          }}
          // The library dims the surround with a 9999em shadow, which WebKit
          // does not draw at all; 9999px covers any dialog and draws everywhere.
          style={{ cropAreaStyle: { boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.5)" } }}
          // Passed as classes, not in cropperProps: a className there replaces
          // the library's own, which draw the circle. An outline, not a ring:
          // the dimmed surround is the area's box-shadow.
          classes={{
            cropAreaClassName:
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white",
          }}
        />
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => setZoom((current) => clampZoom(current - AVATAR_ZOOM.buttonStep))}
            disabled={saving}
            aria-label="Zoom out"
          >
            <ZoomOut aria-hidden="true" />
          </Button>
          <SliderPrimitive.Root
            className="relative flex h-8 w-full touch-none select-none items-center"
            min={AVATAR_ZOOM.min}
            max={AVATAR_ZOOM.max}
            step={AVATAR_ZOOM.step}
            value={[zoom]}
            onValueChange={([next]) => setZoom(clampZoom(next))}
            disabled={saving}
          >
            <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-primary/20">
              <SliderPrimitive.Range className="absolute h-full bg-primary" />
            </SliderPrimitive.Track>
            <SliderPrimitive.Thumb
              aria-label="Zoom"
              aria-valuetext={zoomLabel}
              className="block h-5 w-5 rounded-full border-2 border-primary bg-background shadow transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            />
          </SliderPrimitive.Root>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => setZoom((current) => clampZoom(current + AVATAR_ZOOM.buttonStep))}
            disabled={saving}
            aria-label="Zoom in"
          >
            <ZoomIn aria-hidden="true" />
          </Button>
          <span
            className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground"
            aria-hidden="true"
          >
            {zoomLabel}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => rotate(-90)}
            disabled={saving}
          >
            <RotateCcw aria-hidden="true" /> Rotate left
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => rotate(90)}
            disabled={saving}
          >
            <RotateCw aria-hidden="true" /> Rotate right
          </Button>
        </div>
      </div>

      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button
          type="button"
          onClick={() => area && onSave(area, rotation)}
          disabled={saving || !area}
          aria-busy={saving || undefined}
        >
          {saving && <Loader2 className="animate-spin" aria-hidden="true" />}
          {saving ? "Saving…" : "Save photo"}
        </Button>
      </DialogFooter>
    </>
  );
}
