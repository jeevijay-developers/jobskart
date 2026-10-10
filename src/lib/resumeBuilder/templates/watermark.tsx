// "JobsKart | Created with JobsKart" footer stamped on every page of every resume template.
// `fixed` makes react-pdf repeat it on each page; it's absolutely positioned inside the page's
// bottom margin (buildStyles keeps at least WATERMARK_RESERVE pt there), so it can never overlap
// content or push the layout. Real PDF text, not a webpage overlay.
import { Text, View } from "@react-pdf/renderer";

export const WATERMARK_TEXT = "JobsKart | Created with JobsKart";
// Minimum bottom page padding (pt) so content always stays clear of the watermark.
export const WATERMARK_RESERVE = 30;
const SIZE = 8.5;
const GREY = "#9CA3AF";
const BLUE = "#1A55BD";

// Large diagonal "JOBSKART" brand mark (one per page), matching the reference PDF: light blue-grey,
// low opacity, bold, rising bottom-left to top-right. Sized so the word spans most of the A4 width.
export const DIAGONAL_COLOR = "#94A3B8";
export const DIAGONAL_OPACITY = 0.2;
export const DIAGONAL_ANGLE = 32;
export const DIAGONAL_SIZE_PT = 96; // of a 595pt-wide A4 page

function DiagonalWatermark() {
  return (
    <View
      fixed
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text
        style={{
          fontFamily: "Helvetica-Bold",
          fontSize: DIAGONAL_SIZE_PT,
          color: DIAGONAL_COLOR,
          opacity: DIAGONAL_OPACITY,
          transform: `rotate(-${DIAGONAL_ANGLE}deg)`,
        }}
      >
        JOBSKART
      </Text>
    </View>
  );
}

export function ResumeWatermark() {
  return (
    <>
      <DiagonalWatermark />
      <FooterWatermark />
    </>
  );
}

function FooterWatermark() {
  return (
    <Text
      fixed
      style={{
        position: "absolute",
        bottom: 12,
        right: 24,
        fontSize: SIZE,
        fontFamily: "Helvetica",
        color: GREY,
      }}
    >
      <Text style={{ fontFamily: "Helvetica-Bold", color: BLUE }}>JobsKart</Text>
      {" | Created with JobsKart"}
    </Text>
  );
}
