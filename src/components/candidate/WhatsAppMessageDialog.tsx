import { useEffect, useState } from "react";
import { MessageCircle } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { whatsappUrl } from "@/lib/companyContact";

/** Editable pre-filled WhatsApp message; opens wa.me to the company's number on send. */
export function WhatsAppMessageDialog({
  open,
  onClose,
  phone,
  title,
  initialMessage,
}: {
  open: boolean;
  onClose: () => void;
  phone: string;
  title: string;
  initialMessage: string;
}) {
  const [message, setMessage] = useState(initialMessage);
  useEffect(() => {
    if (open) setMessage(initialMessage);
  }, [open, initialMessage]);
  const url = whatsappUrl(phone, message.trim());
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Edit the message if you like, then send it on WhatsApp.</DialogDescription>
        </DialogHeader>
        <Textarea rows={6} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1000} />
        {!url && <p className="text-xs text-destructive">This number can&apos;t be opened in WhatsApp.</p>}
        <DialogFooter>
          <button
            type="button"
            disabled={!url || !message.trim()}
            onClick={() => {
              if (url) window.open(url, "_blank", "noopener,noreferrer");
              onClose();
            }}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            <MessageCircle className="h-4 w-4" /> Open WhatsApp
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
