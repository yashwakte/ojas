import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ChatbotService } from '../../services/chatbot.service';
import { ChatbotUiService } from '../../services/chatbot-ui.service';
import { ChatbotQuickReply } from '../../models/interfaces';

const CLOSE_MS = 260;
const DRAG_THRESHOLD_PX = 6;
const LONG_PRESS_MS = 550;
const BUBBLE_SIZE = 58;
const EDGE_MARGIN = 4;

interface ChatMessage {
  from: 'bot' | 'user';
  text: string;
  quickReplies?: ChatbotQuickReply[];
  escalate?: boolean;
}

/**
 * A scripted (not LLM) support widget: every reply comes straight from the backend, which only
 * ever answers from live data or fixed, business-approved text. The widget itself just tracks
 * "are we still gathering info for the last topic" - an empty quickReplies list from the backend
 * means yes, keep sending that topic; a non-empty one means the branch resolved, back to the menu.
 *
 * Open/removed/position state lives in ChatbotUiService, shared with other entry points (the
 * hamburger menu, My Orders) - this component is the one place in the app it's rendered.
 */
@Component({
  selector: 'app-chatbot-widget',
  imports: [FormsModule],
  templateUrl: './chatbot-widget.html',
  styleUrl: './chatbot-widget.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatbotWidget {
  private readonly chatbot = inject(ChatbotService);
  readonly ui = inject(ChatbotUiService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly messagesEl = viewChild<ElementRef<HTMLDivElement>>('messagesEl');

  readonly closing = signal(false);
  readonly messages = signal<ChatMessage[]>([]);
  readonly inputValue = signal('');
  readonly busy = signal(false);
  readonly showRemoveHint = signal(false);

  private hasStarted = false;
  private lastTopic: string | null = null;
  private readonly timers: ReturnType<typeof setTimeout>[] = [];

  private dragStart: { pointerX: number; pointerY: number; right: number; bottom: number } | null = null;
  private dragMoved = false;
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Whatever opened the panel - the bubble itself, the hamburger menu, or My Orders - this is
    // where the very first greeting gets requested, exactly once per page session.
    effect(() => {
      if (!this.ui.open() || this.hasStarted) return;
      this.hasStarted = true;
      this.request({});
    });

    // Scroll to the newest message whenever the thread changes.
    effect(() => {
      this.messages();
      const el = this.messagesEl()?.nativeElement;
      if (!el) return;
      this.timers.push(setTimeout(() => (el.scrollTop = el.scrollHeight), 0));
    });

    this.destroyRef.onDestroy(() => this.timers.forEach(clearTimeout));
  }

  close(): void {
    if (this.closing()) return;
    this.closing.set(true);
    this.timers.push(
      setTimeout(() => {
        this.ui.closeChat();
        this.closing.set(false);
      }, CLOSE_MS),
    );
  }

  sendQuickReply(reply: ChatbotQuickReply): void {
    if (this.busy()) return;
    this.messages.update((all) => [...all, { from: 'user', text: reply.label }]);
    this.request({ topic: reply.topic });
  }

  sendTyped(): void {
    const text = this.inputValue().trim();
    if (!text || this.busy()) return;

    this.inputValue.set('');
    this.messages.update((all) => [...all, { from: 'user', text }]);
    this.request({ message: text, topic: this.lastTopic ?? undefined });
  }

  // --- Drag-to-reposition + long-press-to-remove, unified over pointer events (mouse and touch
  // alike). A short tap with negligible movement opens/closes the panel; movement past the
  // threshold is a drag; holding still past LONG_PRESS_MS surfaces the remove option instead. ---

  onBubblePointerDown(event: PointerEvent): void {
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    const pos = this.ui.position();
    this.dragStart = { pointerX: event.clientX, pointerY: event.clientY, right: pos.right, bottom: pos.bottom };
    this.dragMoved = false;

    this.longPressTimer = setTimeout(() => {
      if (!this.dragMoved) this.showRemoveHint.set(true);
    }, LONG_PRESS_MS);
  }

  onBubblePointerMove(event: PointerEvent): void {
    if (!this.dragStart) return;

    const dx = event.clientX - this.dragStart.pointerX;
    const dy = event.clientY - this.dragStart.pointerY;

    if (!this.dragMoved && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
      this.dragMoved = true;
      this.showRemoveHint.set(false);
      if (this.longPressTimer) {
        clearTimeout(this.longPressTimer);
        this.longPressTimer = null;
      }
    }

    if (this.dragMoved) {
      const maxRight = window.innerWidth - BUBBLE_SIZE - EDGE_MARGIN;
      const maxBottom = window.innerHeight - BUBBLE_SIZE - EDGE_MARGIN;
      this.ui.setPosition({
        right: clamp(this.dragStart.right - dx, EDGE_MARGIN, maxRight),
        bottom: clamp(this.dragStart.bottom - dy, EDGE_MARGIN, maxBottom),
      });
    }
  }

  onBubblePointerUp(): void {
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }

    const wasDrag = this.dragMoved;
    const wasLongPress = this.showRemoveHint();
    this.dragStart = null;
    this.dragMoved = false;

    if (wasDrag || wasLongPress) return; // position already applied live, or the hint is showing

    // A plain tap.
    if (this.ui.open()) {
      this.close();
    } else {
      this.ui.openChat();
    }
  }

  confirmRemove(): void {
    this.showRemoveHint.set(false);
    this.ui.remove();
  }

  dismissRemoveHint(): void {
    this.showRemoveHint.set(false);
  }

  private request(payload: { message?: string; topic?: string }): void {
    this.busy.set(true);
    this.chatbot.ask(payload).subscribe({
      next: (res) => {
        this.busy.set(false);
        this.messages.update((all) => [
          ...all,
          { from: 'bot', text: res.reply, quickReplies: res.quickReplies, escalate: res.escalate },
        ]);
        // Empty quickReplies == the bot is still waiting on more input for this topic.
        this.lastTopic = res.quickReplies.length === 0 ? (payload.topic ?? this.lastTopic) : null;
      },
      error: () => {
        this.busy.set(false);
        this.messages.update((all) => [
          ...all,
          {
            from: 'bot',
            text: "Something went wrong on our end. Please try again, or reach us directly at +91 8657781526.",
            quickReplies: [],
            escalate: true,
          },
        ]);
      },
    });
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
