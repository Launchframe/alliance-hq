"use client";

import Lightbox, { type Slide } from "yet-another-react-lightbox";
import Zoom from "yet-another-react-lightbox/plugins/zoom";

import "yet-another-react-lightbox/styles.css";

type Props = {
  open: boolean;
  index: number;
  slides: Slide[];
  onClose: () => void;
  closeLabel: string;
};

export function ScreenshotLightbox({
  open,
  index,
  slides,
  onClose,
  closeLabel,
}: Props) {
  if (slides.length === 0) {
    return null;
  }

  return (
    <Lightbox
      open={open}
      close={onClose}
      index={index}
      slides={slides}
      plugins={[Zoom]}
      zoom={{
        maxZoomPixelRatio: 4,
        scrollToZoom: true,
        pinchZoomV4: true,
        doubleTapDelay: 300,
        doubleClickDelay: 300,
        doubleClickMaxStops: 2,
      }}
      controller={{ closeOnBackdropClick: true }}
      carousel={{ finite: slides.length <= 1 }}
      labels={{ Close: closeLabel }}
    />
  );
}
