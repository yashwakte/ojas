import { TestBed } from '@angular/core/testing';
import { of, throwError, Subject } from 'rxjs';
import { ChatbotWidget } from './chatbot-widget';
import { ChatbotService } from '../../services/chatbot.service';
import { ChatbotUiService } from '../../services/chatbot-ui.service';
import { ChatbotResponse } from '../../models/interfaces';

describe('ChatbotWidget', () => {
  let chatbotServiceSpy: jasmine.SpyObj<ChatbotService>;
  let chatbotUi: ChatbotUiService;

  const greeting: ChatbotResponse = {
    reply: 'Hi! I can help with orders, delivery, stock, or cancellations.',
    escalate: false,
    quickReplies: [
      { label: 'Track my order', topic: 'order-status' },
      { label: 'Check product stock', topic: 'stock' },
    ],
  };

  // A minimal stand-in for PointerEvent - real DOM elements from TestBed-rendered fixtures do
  // support setPointerCapture, but constructing genuine PointerEvents in Karma/Chrome for
  // synthetic coordinates is more ceremony than this needs; the component only reads these
  // three things off the event.
  function pointerEvent(clientX: number, clientY: number): PointerEvent {
    return {
      clientX,
      clientY,
      pointerId: 1,
      target: { setPointerCapture: () => {} },
    } as unknown as PointerEvent;
  }

  beforeEach(() => {
    localStorage.clear();
    chatbotServiceSpy = jasmine.createSpyObj('ChatbotService', ['ask']);
    chatbotServiceSpy.ask.and.returnValue(of(greeting));

    TestBed.configureTestingModule({
      imports: [ChatbotWidget],
      providers: [{ provide: ChatbotService, useValue: chatbotServiceSpy }],
    });
    chatbotUi = TestBed.inject(ChatbotUiService);
  });

  afterEach(() => localStorage.clear());

  function create() {
    const fixture = TestBed.createComponent(ChatbotWidget);
    fixture.detectChanges();
    return fixture;
  }

  function flush(fixture: ReturnType<typeof create>) {
    TestBed.flushEffects();
    fixture.detectChanges();
  }

  it('starts closed with no messages sent', () => {
    const fixture = create();
    expect(chatbotUi.open()).toBeFalse();
    expect(chatbotServiceSpy.ask).not.toHaveBeenCalled();
  });

  it('a plain tap on the bubble opens the panel and requests the greeting', () => {
    const fixture = create();
    const widget = fixture.componentInstance;

    widget.onBubblePointerDown(pointerEvent(300, 700));
    widget.onBubblePointerUp();
    flush(fixture);

    expect(chatbotUi.open()).toBeTrue();
    expect(chatbotServiceSpy.ask).toHaveBeenCalledWith({});
    expect(widget.messages()).toEqual([jasmine.objectContaining({ from: 'bot', text: greeting.reply })]);
  });

  it('re-opening after the first time does not re-request the greeting', () => {
    const fixture = create();
    const widget = fixture.componentInstance;

    widget.onBubblePointerDown(pointerEvent(300, 700));
    widget.onBubblePointerUp();
    flush(fixture);

    widget.close(); // starts the closing animation
    chatbotServiceSpy.ask.calls.reset();
    chatbotUi.openChat();
    flush(fixture);

    expect(chatbotServiceSpy.ask).not.toHaveBeenCalled();
  });

  it('a tap while open closes the panel after the close animation delay', () => {
    jasmine.clock().install();
    try {
      const fixture = create();
      const widget = fixture.componentInstance;
      chatbotUi.openChat();
      flush(fixture);

      widget.onBubblePointerDown(pointerEvent(300, 700));
      widget.onBubblePointerUp();

      expect(widget.closing()).toBeTrue();
      expect(chatbotUi.open()).toBeTrue();

      jasmine.clock().tick(300);
      expect(chatbotUi.open()).toBeFalse();
      expect(widget.closing()).toBeFalse();
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('dragging past the threshold moves the bubble instead of opening it', () => {
    const fixture = create();
    const widget = fixture.componentInstance;
    const startPos = chatbotUi.position();

    widget.onBubblePointerDown(pointerEvent(300, 700));
    widget.onBubblePointerMove(pointerEvent(280, 650)); // moved 20px left, 50px up - past threshold
    widget.onBubblePointerUp();
    flush(fixture);

    expect(chatbotUi.open()).toBeFalse();
    expect(chatbotServiceSpy.ask).not.toHaveBeenCalled();
    // Moved left -> further from the right edge; moved up -> further from the bottom edge.
    expect(chatbotUi.position().right).toBeGreaterThan(startPos.right);
    expect(chatbotUi.position().bottom).toBeGreaterThan(startPos.bottom);
  });

  it('a tiny movement under the drag threshold still counts as a tap', () => {
    const fixture = create();
    const widget = fixture.componentInstance;

    widget.onBubblePointerDown(pointerEvent(300, 700));
    widget.onBubblePointerMove(pointerEvent(302, 701)); // 2-3px jitter, well under the threshold
    widget.onBubblePointerUp();
    flush(fixture);

    expect(chatbotUi.open()).toBeTrue();
  });

  it('holding still past the long-press delay surfaces the remove hint instead of opening', () => {
    jasmine.clock().install();
    try {
      const fixture = create();
      const widget = fixture.componentInstance;

      widget.onBubblePointerDown(pointerEvent(300, 700));
      jasmine.clock().tick(600);
      widget.onBubblePointerUp();

      expect(widget.showRemoveHint()).toBeTrue();
      expect(chatbotUi.open()).toBeFalse();
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('moving during a long-press cancels the remove hint (it becomes a drag instead)', () => {
    jasmine.clock().install();
    try {
      const fixture = create();
      const widget = fixture.componentInstance;

      widget.onBubblePointerDown(pointerEvent(300, 700));
      jasmine.clock().tick(300);
      widget.onBubblePointerMove(pointerEvent(340, 700));
      jasmine.clock().tick(400);

      expect(widget.showRemoveHint()).toBeFalse();
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('confirmRemove hides the bubble via the shared UI service', () => {
    const fixture = create();
    const widget = fixture.componentInstance;
    widget.showRemoveHint.set(true);

    widget.confirmRemove();

    expect(chatbotUi.removed()).toBeTrue();
    expect(widget.showRemoveHint()).toBeFalse();
  });

  it('dismissRemoveHint hides the hint without removing the bubble', () => {
    const fixture = create();
    const widget = fixture.componentInstance;
    widget.showRemoveHint.set(true);

    widget.dismissRemoveHint();

    expect(chatbotUi.removed()).toBeFalse();
    expect(widget.showRemoveHint()).toBeFalse();
  });

  it('openChat from outside the widget (e.g. the hamburger menu) also triggers the greeting', () => {
    const fixture = create();
    const widget = fixture.componentInstance;

    chatbotUi.openChat();
    flush(fixture);

    expect(chatbotServiceSpy.ask).toHaveBeenCalledWith({});
    expect(widget.messages().length).toBe(1);
  });

  it('clicking a quick reply pushes a user message and asks with that topic', () => {
    const fixture = create();
    const widget = fixture.componentInstance;
    chatbotUi.openChat();
    flush(fixture);
    chatbotServiceSpy.ask.calls.reset();
    chatbotServiceSpy.ask.and.returnValue(
      of({ reply: 'Please log in first.', escalate: false, quickReplies: [] }),
    );

    widget.sendQuickReply({ label: 'Track my order', topic: 'order-status' });

    expect(chatbotServiceSpy.ask).toHaveBeenCalledWith({ topic: 'order-status' });
    const messages = widget.messages();
    expect(messages[messages.length - 2]).toEqual(
      jasmine.objectContaining({ from: 'user', text: 'Track my order' }),
    );
  });

  it('typing and sending a message asks with the typed text and clears the input', () => {
    const fixture = create();
    const widget = fixture.componentInstance;
    chatbotUi.openChat();
    flush(fixture);
    chatbotServiceSpy.ask.calls.reset();
    widget.inputValue.set('Is Jowar Flour in stock?');

    widget.sendTyped();

    expect(chatbotServiceSpy.ask).toHaveBeenCalledWith({ message: 'Is Jowar Flour in stock?', topic: undefined });
    expect(widget.inputValue()).toBe('');
  });

  it('does nothing when sendTyped is called with only whitespace', () => {
    const fixture = create();
    const widget = fixture.componentInstance;
    chatbotUi.openChat();
    flush(fixture);
    chatbotServiceSpy.ask.calls.reset();
    widget.inputValue.set('   ');

    widget.sendTyped();

    expect(chatbotServiceSpy.ask).not.toHaveBeenCalled();
  });

  it('an empty quickReplies response keeps the topic active for the next typed message', () => {
    const fixture = create();
    const widget = fixture.componentInstance;
    chatbotUi.openChat();
    flush(fixture);
    chatbotServiceSpy.ask.and.returnValue(
      of({ reply: 'Which product would you like me to check?', escalate: false, quickReplies: [] }),
    );

    widget.sendQuickReply({ label: 'Check product stock', topic: 'stock' });

    chatbotServiceSpy.ask.calls.reset();
    chatbotServiceSpy.ask.and.returnValue(
      of({ reply: 'Jowar Flour is in stock (7 left).', escalate: false, quickReplies: greeting.quickReplies }),
    );
    widget.inputValue.set('Jowar Flour');
    widget.sendTyped();

    expect(chatbotServiceSpy.ask).toHaveBeenCalledWith({ message: 'Jowar Flour', topic: 'stock' });
  });

  it('a resolved answer (non-empty quickReplies) does not carry the topic into the next message', () => {
    const fixture = create();
    const widget = fixture.componentInstance;
    chatbotUi.openChat();
    flush(fixture); // greeting response has non-empty quickReplies already

    chatbotServiceSpy.ask.calls.reset();
    widget.inputValue.set('something else entirely');
    widget.sendTyped();

    expect(chatbotServiceSpy.ask).toHaveBeenCalledWith({ message: 'something else entirely', topic: undefined });
  });

  it('a failed request shows a fallback message with the support number', () => {
    chatbotServiceSpy.ask.and.returnValue(throwError(() => new Error('network down')));
    const fixture = create();
    const widget = fixture.componentInstance;

    chatbotUi.openChat();
    flush(fixture);

    const messages = widget.messages();
    expect(messages[0].text).toContain('8657781526');
    expect(messages[0].escalate).toBeTrue();
  });

  it('quick replies and typed input are ignored while a request is in flight', () => {
    const pending = new Subject<ChatbotResponse>();
    chatbotServiceSpy.ask.and.returnValue(pending.asObservable());
    const fixture = create();
    const widget = fixture.componentInstance;

    chatbotUi.openChat(); // kicks off the (still-pending) greeting request
    flush(fixture);
    expect(widget.busy()).toBeTrue();

    chatbotServiceSpy.ask.calls.reset();
    widget.sendQuickReply({ label: 'Track my order', topic: 'order-status' });
    widget.inputValue.set('hello');
    widget.sendTyped();

    expect(chatbotServiceSpy.ask).not.toHaveBeenCalled();

    pending.next(greeting);
    pending.complete();
  });
});
