// "JobsKart | Created with JobsKart" footer stamped on every page of every resume template.
// `fixed` makes react-pdf repeat it on each page; it's absolutely positioned inside the page's
// bottom margin (buildStyles keeps at least WATERMARK_RESERVE pt there), so it can never overlap
// content or push the layout. Real PDF text, not a webpage overlay.
import { Text } from "@react-pdf/renderer";

export const WATERMARK_TEXT = "JobsKart | Created with JobsKart";
// Minimum bottom page padding (pt) so content always stays clear of the watermark.
export const WATERMARK_RESERVE = 30;
const SIZE = 8.5;
const GREY = "#9CA3AF";
const BLUE = "#1A55BD";

export function ResumeWatermark() {
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
