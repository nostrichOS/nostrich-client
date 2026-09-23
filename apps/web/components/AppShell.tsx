"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { profileDisplayName } from "@nostrich/nostr";
import type { Hex } from "@nostrich/nostr";

import { asset } from "../lib/assets";
import { hidesChrome, useChromeAutoHide } from "../lib/chrome";
import { npubOf } from "../lib/format";
import { homePressIntent } from "../lib/home-tap";
import { useProfile } from "../lib/profiles";
import { Avatar } from "./Avatar";
import { markHydrated, useHydrated } from "../lib/hydrated";
import { ZapOutcomeToast } from "./ZapOutcomeToast";
import { MobileDrawer } from "./MobileDrawer";
import {
  useIsNativeShell,
  useNativeShellAccounts,
  useNativeShellApprovals,
  useNativeShellSession,
  useNativeShellZoomLock,
} from "../lib/native-shell";
import { useChat, useChatSync } from "../lib/chat";
import {
  useLiveNotifications,
  useNotificationsUnread,
  useThinMentionWatch,
  useZapsUnread,
} from "../lib/notifications";
import { clearChatWraps, useChatWrapWatch } from "../lib/chat-alerts";
import { useInboxSplit } from "../lib/chat-inbox";
import { useMuteSync } from "../lib/mute-sync";
import { useAccountAlertsWatch } from "../lib/account-alerts";
import { useSeenSync } from "../lib/seen-sync";
import { useSettingsSync } from "../lib/settings-sync";
import { revealUnread, useUnread } from "../lib/unread";
import { NAV_ITEMS, LeftRail } from "./LeftRail";
import { Prefetch } from "./Prefetch";
import { RightRail } from "./RightRail";
import { ComposeModal } from "./ComposeModal";
import { FxCanvas } from "./FxCanvas";
import { sessionPubkey, useSession } from "./SessionProvider";

/** The app frame: navigation, the reading column, and the sidebar beside. */
/** Routes that give up the right rail and take the full width. */
/** The frame's three columns, as named geometry. */
const COLUMN = {
  /** Icon strip, widening to labels only where a 13" laptop has the room. */
  nav: "nav-column hidden shrink-0 pt-[17px] sm:block w-[88px] min-[1265px]:w-[275px] min-[1265px]:pr-4",
  /** The reading column. */
  feed: "feed-column w-full min-w-0 max-w-[600px] overflow-x-clip border-x border-border standalone:border-t pb-36 sm:pb-6 min-h-dvh max-[1079px]:max-w-none max-[1079px]:flex-1 max-[1079px]:border-r-0",
  /** 980 = 600 + 30 + 350, so a route without the sidebar composes to the same total. */
  feedWide: "feed-column w-full min-w-0 max-w-[980px] overflow-x-clip border-x border-border standalone:border-t",
  /** 350 of CONTENT, the 30px gutter kept outside it as a margin. */
  aside: "aside-column hidden shrink-0 pt-[17px] min-[1080px]:block w-[350px] ml-[30px]",
} as const;

const WIDE_ROUTES: readonly string[] = ["/chat"];

export function AppShell({
  children,
}: {
  children: React.ReactNode;
}): React.ReactNode {
  const [composing, setComposing] = useState(false);
  const pathname = usePathname();
  /** Routes that take the right column's width instead of the right rail. */
  const onRoute = (routes: readonly string[]): boolean =>
    routes.some(
      (route) => pathname === route || pathname.startsWith(`${route}/`),
    );
  const wide = onRoute(WIDE_ROUTES);
  // Starts the scroll watcher for the whole app.
  useChromeAutoHide(hidesChrome(pathname));

  /** Private messages sync for the whole app, not just the Chat screen. */
  const queryClient = useQueryClient();
  const { session: chatSession, accounts } = useSession();
  /* Signs in from the phone's keychain when this page IS the native app. */
  useNativeShellSession();
  useNativeShellApprovals();
  /* A native app does not pinch-zoom. */
  useNativeShellZoomLock();
  const chatPubkey = sessionPubkey(chatSession);
  /** Every account except the one in front. */
  /* IN THE APP THE OTHER ACCOUNTS ARE NOT IN THIS SESSION. */
  const inShell = useIsNativeShell();
  const shellAccounts = useNativeShellAccounts();
  const otherAccounts = useMemo(
    () =>
      inShell
        ? shellAccounts
            .filter((pubkey) => pubkey !== chatPubkey)
            .map((pubkey) => ({ pubkey: pubkey as Hex }))
        : accounts
            .filter((account) => account.pubkey !== chatPubkey)
            .map((account) => ({
              pubkey: account.pubkey,
              ...(account.session.status === "signed" &&
              account.session.signer.kind === "privatekey"
                ? { signer: account.session.signer }
                : {}),
            })),
    [accounts, chatPubkey, inShell, shellAccounts],
  );
  useChatSync(
    chatSession.status === "signed" ? chatSession.signer : undefined,
    chatPubkey,
  );
  // Carries the mute list between devices over NIP-51. Additive and local-first.
  useMuteSync(
    chatSession.status === "signed" ? chatSession.signer : undefined,
    chatPubkey,
  );

  /** Read markers, carried between devices over NIP-78. Reading your notifications. */
  useSeenSync(
    chatSession.status === "signed" ? chatSession.signer : undefined,
    chatPubkey,
  );

  /** The reader's SETTINGS, carried the same way. */
  useSettingsSync(
    chatSession.status === "signed" ? chatSession.signer : undefined,
    chatPubkey,
  );

  /** Notifications as they land, so the dot appears without a reload. */
  useLiveNotifications(chatPubkey);

  /** And who is allowed to put a mention in that dot. */
  useThinMentionWatch(chatPubkey);

  /** And the accounts that are NOT in front, so their dots can appear in the switcher. */
  useAccountAlertsWatch(otherAccounts);

  /** A SWITCH IS NOT A NAVIGATION. */
  /** Hydration. */
  useHydrated();
  useEffect(markHydrated, []);

  const switched = useRef(false);
  useEffect(() => {
    if (!switched.current) {
      switched.current = true;
      return;
    }
    if (chatPubkey === undefined) return;
    void queryClient.invalidateQueries({
      queryKey: ["notifications", chatPubkey],
    });
    void queryClient.invalidateQueries({ queryKey: ["follows", chatPubkey] });
  }, [chatPubkey, queryClient]);

  /** Gift wraps arriving, counted without opening any. */
  useChatWrapWatch(chatPubkey);

  /** Once the inbox IS decrypted, its count is the only one that should speak. */
  const chatLoading = useChat(chatPubkey).loading;
  useEffect(() => {
    if (!chatLoading) clearChatWraps(chatPubkey);
  }, [chatLoading, chatPubkey]);

  return (
    <>
      {/* The pages the reader has not opened yet, warmed once this one is idle. */}
      <Prefetch pubkey={chatPubkey} />

      <MobileHeader />

      {/* COLUMN WIDTHS ARE X'S, MEASURED RATHER THAN GUESSED. */}
      <div
        className={
          /* `justify-start` below 1080, where there is no right rail to balance. */
              "mx-auto flex w-full max-w-[1255px] justify-center max-[1079px]:justify-start overflow-x-clip"
        }
      >
          <aside className={COLUMN.nav}>
            <LeftRail onCompose={() => setComposing(true)} />
          </aside>

        <main
          id="main"
          tabIndex={-1}
          /* The top rule is drawn only in an installed window. */
          className={wide ? COLUMN.feedWide : COLUMN.feed}
        >
          {children}
        </main>

        {/* 1080 clears the widest portrait tablet, which is the line between a tablet. */}
        {wide ? null : (
          <aside className={COLUMN.aside}>
            <RightRail />
          </aside>
        )}
      </div>

      <BottomBar onCompose={() => setComposing(true)} />
      {composing ? <ComposeModal onClose={() => setComposing(false)} /> : null}
      {/* One canvas for every zap and like on the page. */}
      <FxCanvas />
    </>
  );
}

/** Mobile navigation. */
/** One box for both states of the floating action, so signing in cannot move. */
const FLOATING_ACTION =
  "chrome-float fixed bottom-[calc(79px+var(--bottom-nav-inset))] right-4 z-40 flex size-14 items-center justify-center rounded-full bg-text text-bg shadow-lg hover:opacity-90 sm:hidden";

function BottomBar({ onCompose }: { onCompose: () => void }): React.ReactNode {
  const unreadDot = useUnread() > 0;
  const { session: dotSession } = useSession();
  const dotPubkey = sessionPubkey(dotSession);
  const notificationsUnread = useNotificationsUnread(dotPubkey) > 0;
  // Inbox only.
  const chatUnread = useInboxSplit(dotPubkey).inboxUnread > 0;
  /** Zaps, which this row could not light until now. */
  const zapsUnread = useZapsUnread(dotPubkey) > 0;
  const pathname = usePathname();
  const { session } = useSession();
  const signedIn = sessionPubkey(session) !== undefined;

  // Explicit order, not NAV_ITEMS order.
  /** Five destinations, and WHICH five is the whole decision. */
  const MOBILE = ["/", "/explore", "/zaps", "/notifications", "/chat"];
  const items = MOBILE.map((href) =>
    NAV_ITEMS.find((item) => item.href === href),
  ).filter((item): item is (typeof NAV_ITEMS)[number] => item !== undefined);

  return (
    <>
      {/* Compose floats above the bar rather than taking a sixth slot. */}
      {/* `chrome-float` rides it off the bottom with the bar, rather than leaving. */}
      {/* The feed only. */}
      {/** SIGNED IN ONLY. A reader with no key sees nothing here at all. */}
      {pathname === "/" && signedIn ? (
        <button
          type="button"
          onClick={onCompose}
          aria-label="Write a note"
          // Black, like every other primary action in the app.
          className={FLOATING_ACTION}
        >
          <span
            className="material-symbols-outlined text-[28px]!"
            aria-hidden="true"
          >
            edit_square
          </span>
        </button>
      ) : null}

      <nav
        aria-label="Primary"
        /* `--bottom-nav-inset`, not `env(safe-area-inset-bottom)` directly. */
        className="chrome-bottom fixed inset-x-0 bottom-0 z-30 flex border-t border-border/60 bg-bg pb-[var(--bottom-nav-inset)] sm:hidden"
      >
        {items.map((item) => {
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.auth === true && !signedIn ? "/login" : item.href}
              aria-current={active ? "page" : undefined}
              /* ONE PRESS, AND YOU ARE AT THE TOP. */
              onClick={(e) => {
                if (item.href === "/") {
                  /* ALREADY HOME -> THE TOP. ANYWHERE ELSE ->. */
                  if (homePressIntent(pathname === "/") === "return") return;
                  e.preventDefault();
                  // A lit dot means held notes, and reaching the top past them would leave the reader.
                  revealUnread();
                  window.scrollTo({ top: 0 });
                  return;
                }
                window.scrollTo({ top: 0 });
              }}
              className="relative flex h-[68px] flex-1 items-center justify-center"
            >
              {/* `text-nav-icon`, exactly as the desktop rail does. */}
              <span className="flex text-nav-icon">
                {item.svg === undefined ? (
                  <span
                    className="material-symbols-outlined text-[31px]!"
                    aria-hidden="true"
                  >
                    {item.icon}
                  </span>
                ) : (
                  <svg
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    // Tracks the font size beside it: 2px under, the offset that makes a box-filling SVG.
                    className="size-[29px]"
                    fill="none"
                    stroke="currentColor"
                    // 2dp on a 24dp grid, same derivation as LeftRail: the glyphs beside this render 2 x.
                    strokeWidth={2.25}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d={item.svg} />
                  </svg>
                )}
              </span>
              {/* The same three rows as the desktop rail. */}
              {dotFor(
                item.href,
                unreadDot,
                notificationsUnread,
                chatUnread,
                zapsUnread,
              ) ? (
                <span
                  aria-hidden="true"
                  className="absolute right-[calc(50%-19px)] top-2.5 size-2.5 rounded-full bg-[#f97315] ring-2 ring-bg"
                />
              ) : null}
              <span className="sr-only">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}

/** Top bar for phones. */
function MobileHeader(): React.ReactNode {
  const { session, ready } = useSession();
  const pubkey = sessionPubkey(session);
  const profile = useProfile(pubkey);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      <MobileDrawer
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        pubkey={pubkey}
      />
      {/* The zap dialog closes on the press now, so a failed zap has nowhere else to be said. */}
      <ZapOutcomeToast />

      {/* THREE columns, not two, and that is what centres the logo. */}
      <header
        /* The right column is 3rem for an avatar and AUTO for the Sign In pill. */
        className={`chrome-top sticky top-0 z-40 grid h-16 ${
          ready && pubkey === undefined
            ? "grid-cols-[3rem_1fr_auto]"
            : "grid-cols-[3rem_1fr_3rem]"
        } items-center border-b border-border bg-bg px-4 sm:hidden`}
      >
        {/* THE MENU, on the left, opened by your own face. */}
        {ready && pubkey !== undefined ? (
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
            aria-expanded={menuOpen}
            className="flex size-10 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-bg-inset"
          >
            <Avatar
              pubkey={pubkey}
              name={profileDisplayName({ ...profile, pubkey })}
              picture={profile?.picture}
              size="sm"
            />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
            aria-expanded={menuOpen}
            className="flex size-10 cursor-pointer items-center justify-center rounded-full text-text transition-colors hover:bg-bg-inset"
          >
            <span
              className="material-symbols-outlined text-[26px]!"
              aria-hidden="true"
            >
              menu
            </span>
          </button>
        )}

        <Link
          href="/"
          aria-label="Nostrich home"
          className="flex items-center justify-center"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- static asset, fixed size. */}
          <img
            src={asset("/logo-horizontal.svg")}
            alt="Nostrich"
            className="h-10 w-auto"
          />
        </Link>

        {/* The right column stays EMPTY when signed. */}
        <div className="flex justify-end">
          {ready && pubkey === undefined ? (
            <Link
              href="/login"
              // Pill, matching the rail's Sign.
              className="whitespace-nowrap rounded-full bg-text px-3 py-1.5 text-sm font-bold text-bg transition-opacity hover:opacity-90"
            >
              Sign In
            </Link>
          ) : null}
        </div>
      </header>
    </>
  );
}

/** Which nav row has something waiting behind. */
function dotFor(
  href: string,
  feed: boolean,
  notifications: boolean,
  chat: boolean,
  zaps: boolean,
): boolean {
  if (href === "/") return feed;
  if (href === "/notifications") return notifications;
  if (href === "/chat") return chat;
  // A zap lights this AND notifications: it is both money arriving and somebody.
  if (href === "/zaps") return zaps;
  return false;
}
