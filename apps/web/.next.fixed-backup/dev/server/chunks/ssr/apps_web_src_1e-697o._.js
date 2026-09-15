module.exports = [
"[project]/apps/web/src/app/not-found.jsx [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "default",
    ()=>NotFound,
    "metadata",
    ()=>metadata
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@16.3.5_@playwright+test@1.63.0_@types+node@26.5.1_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-jsx-dev-runtime.js [app-rsc] (ecmascript)");
/**
 * The 404 page for URLs that match no route at all.
 *
 * Next.js renders this file through its router — not through the render-error
 * path `notFound()` uses — so an unmatched URL genuinely answers `404` with the
 * complete page in the first response. Routes that discover a *missing
 * resource* render {@link NotFoundView} directly instead; see
 * `components/not-found-view.jsx` for why.
 *
 * @module app/not-found
 */ var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$components$2f$not$2d$found$2d$view$2e$jsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/src/components/not-found-view.jsx [app-rsc] (ecmascript)");
;
;
const metadata = {
    title: 'Page not found',
    robots: {
        index: false,
        follow: false
    }
};
function NotFound() {
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$components$2f$not$2d$found$2d$view$2e$jsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["NotFoundView"], {}, void 0, false, {
        fileName: "[project]/apps/web/src/app/not-found.jsx",
        lineNumber: 26,
        columnNumber: 10
    }, this);
}
}),
"[project]/apps/web/src/app/not-found.jsx [app-rsc] (ecmascript, Next.js Server Component)", (function(__turbopack_context__){

__turbopack_context__.n(__turbopack_context__.i("[project]/apps/web/src/app/not-found.jsx [app-rsc] (ecmascript)"));
}),
"[project]/apps/web/src/components/not-found-view.jsx [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "NotFoundView",
    ()=>NotFoundView
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@16.3.5_@playwright+test@1.63.0_@types+node@26.5.1_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-jsx-dev-runtime.js [app-rsc] (ecmascript)");
/**
 * The one "not found" view the whole site uses.
 *
 * Two things about it are deliberate.
 *
 * The first is that it renders on the server with no motion, no state and no
 * client component in its tree. Next.js 16.3.5 cannot server-render the UI
 * behind `notFound()` — the response it builds for that call is an empty
 * document that only fills in once the browser has hydrated — so every route
 * that discovers a missing resource renders *this* instead, and a visitor with
 * no JavaScript, a slow connection or a text browser still gets a page.
 *
 * The second is that the wording never changes. A missing event, an event that
 * was never published, one pulled by moderation, a private draft and a deleted
 * one all produce exactly these words, so the page cannot be used to probe
 * which of those a URL happens to be.
 *
 * @module components/not-found-view
 */ var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$client$2f$app$2d$dir$2f$link$2e$react$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@16.3.5_@playwright+test@1.63.0_@types+node@26.5.1_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/next/dist/client/app-dir/link.react-server.js [app-rsc] (ecmascript)");
;
;
/** Shared link styling for the primary action. */ const primaryLink = 'inline-flex h-12 items-center justify-center rounded-lg bg-marigold-600 px-6 text-base ' + 'font-medium text-white shadow-sm transition-colors hover:bg-marigold-700 ' + 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marigold-500 ' + 'focus-visible:ring-offset-2';
/** Shared link styling for the secondary actions. */ const secondaryLink = 'inline-flex h-12 items-center justify-center rounded-lg border border-slate-300 bg-white ' + 'px-6 text-base font-medium text-slate-900 transition-colors hover:bg-slate-50 ' + 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marigold-500 ' + 'focus-visible:ring-offset-2';
function NotFoundView() {
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        "data-testid": "not-found-view",
        className: "mx-auto max-w-2xl px-4 py-20 text-center",
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                "aria-hidden": "true",
                className: "font-display text-6xl text-marigold-500",
                children: "✺"
            }, void 0, false, {
                fileName: "[project]/apps/web/src/components/not-found-view.jsx",
                lineNumber: 45,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("h1", {
                className: "mt-6 text-3xl font-bold text-indigo-night-900 sm:text-4xl",
                children: "This one is not on the bill"
            }, void 0, false, {
                fileName: "[project]/apps/web/src/components/not-found-view.jsx",
                lineNumber: 48,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                className: "mt-4 text-lg text-slate-700",
                children: "The page you were looking for has either finished its run or never existed. The rest of the programme is still going."
            }, void 0, false, {
                fileName: "[project]/apps/web/src/components/not-found-view.jsx",
                lineNumber: 51,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "mt-8 flex flex-wrap justify-center gap-3",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$client$2f$app$2d$dir$2f$link$2e$react$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["default"], {
                        href: "/events",
                        className: primaryLink,
                        children: "Browse every event"
                    }, void 0, false, {
                        fileName: "[project]/apps/web/src/components/not-found-view.jsx",
                        lineNumber: 56,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$client$2f$app$2d$dir$2f$link$2e$react$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["default"], {
                        href: "/events#filter-q",
                        className: secondaryLink,
                        children: "Search events"
                    }, void 0, false, {
                        fileName: "[project]/apps/web/src/components/not-found-view.jsx",
                        lineNumber: 59,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$client$2f$app$2d$dir$2f$link$2e$react$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["default"], {
                        href: "/",
                        className: secondaryLink,
                        children: "Back to the home page"
                    }, void 0, false, {
                        fileName: "[project]/apps/web/src/components/not-found-view.jsx",
                        lineNumber: 62,
                        columnNumber: 9
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/apps/web/src/components/not-found-view.jsx",
                lineNumber: 55,
                columnNumber: 7
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/apps/web/src/components/not-found-view.jsx",
        lineNumber: 44,
        columnNumber: 5
    }, this);
}
}),
];

//# sourceMappingURL=apps_web_src_1e-697o._.js.map