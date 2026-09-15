module.exports = [
"[project]/apps/web/src/app/layout.jsx [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/**
 * The root layout: the document shell every page renders inside.
 *
 * @module app/layout
 */ __turbopack_context__.s([
    "default",
    ()=>RootLayout,
    "metadata",
    ()=>metadata,
    "viewport",
    ()=>viewport
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@16.3.5_@playwright+test@1.63.0_@types+node@26.5.1_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-jsx-dev-runtime.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$components$2f$site$2d$footer$2e$jsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/src/components/site-footer.jsx [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$components$2f$site$2d$header$2e$jsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/src/components/site-header.jsx [app-rsc] (ecmascript)");
;
;
;
;
/** Where this deployment is served from, used to resolve relative metadata URLs. */ const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://127.0.0.1:3000';
const metadata = {
    metadataBase: new URL(siteUrl),
    title: {
        default: 'Desi-Event — garba, qawwali, melas and stand-up, ticketed properly',
        template: '%s · Desi-Event'
    },
    description: 'Find and book South Asian events near you: Navratri garba nights, qawwali mehfils, Diwali melas, Bollywood nights, classical dance and diaspora comedy across Mumbai, Ahmedabad, Toronto and London.',
    applicationName: 'Desi-Event',
    keywords: [
        'garba tickets',
        'dandiya night',
        'qawwali concert',
        'Diwali mela',
        'Bollywood night',
        'South Asian events',
        'desi events near me'
    ],
    openGraph: {
        type: 'website',
        siteName: 'Desi-Event',
        locale: 'en_IN',
        title: 'Desi-Event — garba, qawwali, melas and stand-up',
        description: 'Nine nights of garba in Ahmedabad, a qawwali mehfil in Bombay, a Diwali mela in Mississauga and stand-up in Limehouse. All in one place.'
    },
    twitter: {
        card: 'summary_large_image',
        title: 'Desi-Event',
        description: 'South Asian events, ticketed properly.'
    },
    robots: {
        index: true,
        follow: true
    }
};
const viewport = {
    themeColor: '#f5a524',
    width: 'device-width',
    initialScale: 1
};
function RootLayout({ children }) {
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("html", {
        lang: "en-IN",
        "data-scroll-behavior": "smooth",
        children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("body", {
            className: "flex min-h-dvh flex-col",
            children: [
                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("a", {
                    className: "skip-link",
                    href: "#main-content",
                    children: "Skip to main content"
                }, void 0, false, {
                    fileName: "[project]/apps/web/src/app/layout.jsx",
                    lineNumber: 79,
                    columnNumber: 9
                }, this),
                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$components$2f$site$2d$header$2e$jsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["SiteHeader"], {}, void 0, false, {
                    fileName: "[project]/apps/web/src/app/layout.jsx",
                    lineNumber: 82,
                    columnNumber: 9
                }, this),
                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("main", {
                    id: "main-content",
                    tabIndex: -1,
                    className: "flex-1",
                    children: children
                }, void 0, false, {
                    fileName: "[project]/apps/web/src/app/layout.jsx",
                    lineNumber: 83,
                    columnNumber: 9
                }, this),
                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$components$2f$site$2d$footer$2e$jsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["SiteFooter"], {}, void 0, false, {
                    fileName: "[project]/apps/web/src/app/layout.jsx",
                    lineNumber: 86,
                    columnNumber: 9
                }, this)
            ]
        }, void 0, true, {
            fileName: "[project]/apps/web/src/app/layout.jsx",
            lineNumber: 78,
            columnNumber: 7
        }, this)
    }, void 0, false, {
        fileName: "[project]/apps/web/src/app/layout.jsx",
        lineNumber: 77,
        columnNumber: 5
    }, this);
}
}),
"[project]/apps/web/src/app/layout.jsx [app-rsc] (ecmascript, Next.js Server Component)", (function(__turbopack_context__){

__turbopack_context__.n(__turbopack_context__.i("[project]/apps/web/src/app/layout.jsx [app-rsc] (ecmascript)"));
}),
"[project]/apps/web/src/components/site-footer.jsx [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "SiteFooter",
    ()=>SiteFooter
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@16.3.5_@playwright+test@1.63.0_@types+node@26.5.1_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-jsx-dev-runtime.js [app-rsc] (ecmascript)");
/**
 * The site footer: secondary navigation and the small print.
 *
 * @module components/site-footer
 */ var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$client$2f$app$2d$dir$2f$link$2e$react$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@16.3.5_@playwright+test@1.63.0_@types+node@26.5.1_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/next/dist/client/app-dir/link.react-server.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$catalog$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/src/lib/catalog.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$search$2d$params$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/src/lib/search-params.js [app-rsc] (ecmascript)");
;
;
;
;
/** Cities the platform has a meaningful programme in. */ const CITIES = [
    'Mumbai',
    'Ahmedabad',
    'Toronto',
    'London'
];
/** The first six categories, which is as many as the footer has room for. */ const FOOTER_CATEGORIES = __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$catalog$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["EVENT_CATEGORIES"].slice(0, 6);
function SiteFooter() {
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("footer", {
        className: "mt-16 border-t border-slate-200 bg-indigo-night-950 text-slate-300",
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "mx-auto grid max-w-6xl grid-cols-1 gap-8 px-4 py-12 sm:grid-cols-2 lg:grid-cols-4",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "sm:col-span-2 lg:col-span-1",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                                className: "font-display text-lg font-bold text-white",
                                children: [
                                    "Desi",
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                        className: "text-marigold-400",
                                        children: "-"
                                    }, void 0, false, {
                                        fileName: "[project]/apps/web/src/components/site-footer.jsx",
                                        lineNumber: 29,
                                        columnNumber: 17
                                    }, this),
                                    "Event"
                                ]
                            }, void 0, true, {
                                fileName: "[project]/apps/web/src/components/site-footer.jsx",
                                lineNumber: 28,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                                className: "mt-3 max-w-prose text-sm text-slate-400",
                                children: "Garba nights, qawwali mehfils, melas and stand-up — ticketed properly, for the South Asian diaspora and everyone who turns up with them."
                            }, void 0, false, {
                                fileName: "[project]/apps/web/src/components/site-footer.jsx",
                                lineNumber: 31,
                                columnNumber: 11
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/apps/web/src/components/site-footer.jsx",
                        lineNumber: 27,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("nav", {
                        "aria-labelledby": "footer-categories",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("h2", {
                                id: "footer-categories",
                                className: "text-sm font-semibold text-white",
                                children: "Browse"
                            }, void 0, false, {
                                fileName: "[project]/apps/web/src/components/site-footer.jsx",
                                lineNumber: 38,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("ul", {
                                className: "mt-3 space-y-2 text-sm",
                                children: FOOTER_CATEGORIES.map((category)=>/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("li", {
                                        children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$client$2f$app$2d$dir$2f$link$2e$react$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["default"], {
                                            href: (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$search$2d$params$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["buildEventsHref"])({
                                                category: category.value
                                            }),
                                            className: "rounded-sm text-slate-400 transition-colors hover:text-marigold-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marigold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-indigo-night-950",
                                            children: category.label
                                        }, void 0, false, {
                                            fileName: "[project]/apps/web/src/components/site-footer.jsx",
                                            lineNumber: 44,
                                            columnNumber: 17
                                        }, this)
                                    }, category.value, false, {
                                        fileName: "[project]/apps/web/src/components/site-footer.jsx",
                                        lineNumber: 43,
                                        columnNumber: 15
                                    }, this))
                            }, void 0, false, {
                                fileName: "[project]/apps/web/src/components/site-footer.jsx",
                                lineNumber: 41,
                                columnNumber: 11
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/apps/web/src/components/site-footer.jsx",
                        lineNumber: 37,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("nav", {
                        "aria-labelledby": "footer-cities",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("h2", {
                                id: "footer-cities",
                                className: "text-sm font-semibold text-white",
                                children: "Cities"
                            }, void 0, false, {
                                fileName: "[project]/apps/web/src/components/site-footer.jsx",
                                lineNumber: 56,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("ul", {
                                className: "mt-3 space-y-2 text-sm",
                                children: CITIES.map((city)=>/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("li", {
                                        children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$client$2f$app$2d$dir$2f$link$2e$react$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["default"], {
                                            href: (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$search$2d$params$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["buildEventsHref"])({
                                                city
                                            }),
                                            className: "rounded-sm text-slate-400 transition-colors hover:text-marigold-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marigold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-indigo-night-950",
                                            children: city
                                        }, void 0, false, {
                                            fileName: "[project]/apps/web/src/components/site-footer.jsx",
                                            lineNumber: 62,
                                            columnNumber: 17
                                        }, this)
                                    }, city, false, {
                                        fileName: "[project]/apps/web/src/components/site-footer.jsx",
                                        lineNumber: 61,
                                        columnNumber: 15
                                    }, this))
                            }, void 0, false, {
                                fileName: "[project]/apps/web/src/components/site-footer.jsx",
                                lineNumber: 59,
                                columnNumber: 11
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/apps/web/src/components/site-footer.jsx",
                        lineNumber: 55,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("h2", {
                                className: "text-sm font-semibold text-white",
                                children: "Organisers"
                            }, void 0, false, {
                                fileName: "[project]/apps/web/src/components/site-footer.jsx",
                                lineNumber: 74,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                                className: "mt-3 text-sm text-slate-400",
                                children: "Running a night of your own? Desi-Event handles ticketing, holds, door scanning and payouts in your own currency."
                            }, void 0, false, {
                                fileName: "[project]/apps/web/src/components/site-footer.jsx",
                                lineNumber: 75,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                                className: "mt-3 text-sm text-slate-400",
                                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("a", {
                                    href: "mailto:organisers@desi-event.example",
                                    className: "rounded-sm text-marigold-300 underline underline-offset-4 hover:text-marigold-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marigold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-indigo-night-950",
                                    children: "organisers@desi-event.example"
                                }, void 0, false, {
                                    fileName: "[project]/apps/web/src/components/site-footer.jsx",
                                    lineNumber: 80,
                                    columnNumber: 13
                                }, this)
                            }, void 0, false, {
                                fileName: "[project]/apps/web/src/components/site-footer.jsx",
                                lineNumber: 79,
                                columnNumber: 11
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/apps/web/src/components/site-footer.jsx",
                        lineNumber: 73,
                        columnNumber: 9
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/apps/web/src/components/site-footer.jsx",
                lineNumber: 26,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "border-t border-white/10",
                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                    className: "mx-auto max-w-6xl px-4 py-5 text-xs text-slate-500",
                    children: "A demonstration project. Every event, organiser and price on this site is fictional."
                }, void 0, false, {
                    fileName: "[project]/apps/web/src/components/site-footer.jsx",
                    lineNumber: 91,
                    columnNumber: 9
                }, this)
            }, void 0, false, {
                fileName: "[project]/apps/web/src/components/site-footer.jsx",
                lineNumber: 90,
                columnNumber: 7
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/apps/web/src/components/site-footer.jsx",
        lineNumber: 25,
        columnNumber: 5
    }, this);
}
}),
"[project]/apps/web/src/components/site-header.jsx [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "SiteHeader",
    ()=>SiteHeader
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@16.3.5_@playwright+test@1.63.0_@types+node@26.5.1_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-jsx-dev-runtime.js [app-rsc] (ecmascript)");
/**
 * The site header: brand, primary navigation and a direct route into search.
 *
 * @module components/site-header
 */ var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$client$2f$app$2d$dir$2f$link$2e$react$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@16.3.5_@playwright+test@1.63.0_@types+node@26.5.1_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/next/dist/client/app-dir/link.react-server.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$search$2d$params$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/src/lib/search-params.js [app-rsc] (ecmascript)");
;
;
;
/** Primary navigation. Kept to four items so it fits a 360px viewport. */ const NAV_LINKS = [
    {
        href: '/events',
        label: 'All events'
    },
    {
        href: (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$search$2d$params$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["buildEventsHref"])({
            category: 'GARBA_DANDIYA'
        }),
        label: 'Garba'
    },
    {
        href: (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$search$2d$params$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["buildEventsHref"])({
            category: 'MUSIC_CONCERT'
        }),
        label: 'Live music'
    },
    {
        href: (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$search$2d$params$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["buildEventsHref"])({
            category: 'COMEDY'
        }),
        label: 'Comedy'
    }
];
function SiteHeader() {
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("header", {
        className: "sticky top-0 z-40 border-b border-marigold-200/70 bg-white/90 backdrop-blur-sm",
        children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
            className: "mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3",
            children: [
                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$client$2f$app$2d$dir$2f$link$2e$react$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["default"], {
                    href: "/",
                    className: "flex items-baseline gap-2 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marigold-500 focus-visible:ring-offset-2",
                    children: [
                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                            className: "font-display text-xl font-bold tracking-tight text-indigo-night-900",
                            children: [
                                "Desi",
                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                    className: "text-marigold-600",
                                    children: "-"
                                }, void 0, false, {
                                    fileName: "[project]/apps/web/src/components/site-header.jsx",
                                    lineNumber: 33,
                                    columnNumber: 17
                                }, this),
                                "Event"
                            ]
                        }, void 0, true, {
                            fileName: "[project]/apps/web/src/components/site-header.jsx",
                            lineNumber: 32,
                            columnNumber: 11
                        }, this),
                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                            "aria-hidden": "true",
                            className: "hidden text-sm text-marigold-700 sm:inline",
                            children: "देसी इवेंट"
                        }, void 0, false, {
                            fileName: "[project]/apps/web/src/components/site-header.jsx",
                            lineNumber: 35,
                            columnNumber: 11
                        }, this)
                    ]
                }, void 0, true, {
                    fileName: "[project]/apps/web/src/components/site-header.jsx",
                    lineNumber: 28,
                    columnNumber: 9
                }, this),
                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("nav", {
                    "aria-label": "Primary",
                    children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("ul", {
                        className: "flex flex-wrap items-center gap-x-1 gap-y-1 text-sm",
                        children: NAV_LINKS.map((link)=>/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("li", {
                                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$client$2f$app$2d$dir$2f$link$2e$react$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["default"], {
                                    href: link.href,
                                    className: "inline-flex rounded-lg px-2.5 py-1.5 font-medium text-slate-700 transition-colors hover:bg-marigold-50 hover:text-marigold-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marigold-500 focus-visible:ring-offset-2",
                                    children: link.label
                                }, void 0, false, {
                                    fileName: "[project]/apps/web/src/components/site-header.jsx",
                                    lineNumber: 44,
                                    columnNumber: 17
                                }, this)
                            }, link.href, false, {
                                fileName: "[project]/apps/web/src/components/site-header.jsx",
                                lineNumber: 43,
                                columnNumber: 15
                            }, this))
                    }, void 0, false, {
                        fileName: "[project]/apps/web/src/components/site-header.jsx",
                        lineNumber: 41,
                        columnNumber: 11
                    }, this)
                }, void 0, false, {
                    fileName: "[project]/apps/web/src/components/site-header.jsx",
                    lineNumber: 40,
                    columnNumber: 9
                }, this)
            ]
        }, void 0, true, {
            fileName: "[project]/apps/web/src/components/site-header.jsx",
            lineNumber: 27,
            columnNumber: 7
        }, this)
    }, void 0, false, {
        fileName: "[project]/apps/web/src/components/site-header.jsx",
        lineNumber: 26,
        columnNumber: 5
    }, this);
}
}),
"[project]/apps/web/src/lib/catalog.js [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/**
 * Presentation vocabulary for the event catalogue.
 *
 * The API speaks in `EventCategory` enum members; visitors do not. Everything
 * that turns a machine value into something a person reads — labels, blurbs,
 * the glyph on a poster — lives here so the wording is identical on the home
 * page, the listing and the detail page.
 *
 * @module lib/catalog
 */ /**
 * @typedef {object} CategoryDescriptor
 * @property {string} value The `EventCategory` enum member.
 * @property {string} label Short human label used in filters and badges.
 * @property {string} blurb One line of copy for the category browsing cards.
 * @property {string} glyph A single character used as a decorative poster mark.
 */ /**
 * Every event category, in the order they are offered for browsing.
 *
 * The order is editorial rather than alphabetical: the things the diaspora
 * actually buys tickets for first.
 *
 * @type {ReadonlyArray<CategoryDescriptor>}
 */ __turbopack_context__.s([
    "EVENT_CATEGORIES",
    ()=>EVENT_CATEGORIES,
    "categoriesWithEvents",
    ()=>categoriesWithEvents,
    "categoryDescriptor",
    ()=>categoryDescriptor,
    "categoryLabel",
    ()=>categoryLabel,
    "citiesWithEvents",
    ()=>citiesWithEvents,
    "describeCategories",
    ()=>describeCategories,
    "filterEvents",
    ()=>filterEvents,
    "sortByStartDate",
    ()=>sortByStartDate
]);
const EVENT_CATEGORIES = Object.freeze([
    {
        value: 'GARBA_DANDIYA',
        label: 'Garba & Dandiya',
        blurb: 'Nine nights, live dhol and a circle that keeps getting wider.',
        glyph: '◉'
    },
    {
        value: 'MUSIC_CONCERT',
        label: 'Live Music',
        blurb: 'Qawwali, ghazal, indie and playback — amplified and in person.',
        glyph: '♪'
    },
    {
        value: 'BOLLYWOOD_NIGHT',
        label: 'Bollywood Nights',
        blurb: 'Filmi floor-fillers from the retro era to last Friday’s release.',
        glyph: '★'
    },
    {
        value: 'CLASSICAL_DANCE',
        label: 'Classical Dance',
        blurb: 'Bharatanatyam, Kathak and Odissi, with live accompaniment.',
        glyph: '❧'
    },
    {
        value: 'COMEDY',
        label: 'Comedy',
        blurb: 'Stand-up that has moved on from jokes about your mother.',
        glyph: '☺'
    },
    {
        value: 'FOOD_FESTIVAL',
        label: 'Food Festivals',
        blurb: 'Chaat, kottu, kulcha and an argument about the best chai.',
        glyph: '❂'
    },
    {
        value: 'CULTURAL_FESTIVAL',
        label: 'Melas & Festivals',
        blurb: 'Diwali, Pongal, Baisakhi and everything the whole family turns up to.',
        glyph: '✺'
    },
    {
        value: 'FILM_SCREENING',
        label: 'Film',
        blurb: 'Restorations, premieres and retrospectives on a real screen.',
        glyph: '▣'
    },
    {
        value: 'THEATRE',
        label: 'Theatre',
        blurb: 'Natak, drama and new writing, often with surtitles.',
        glyph: '⌘'
    },
    {
        value: 'WORKSHOP',
        label: 'Workshops',
        blurb: 'Learn the steps, the beats or the recipe from someone who knows.',
        glyph: '✎'
    },
    {
        value: 'RELIGIOUS',
        label: 'Religious & Devotional',
        blurb: 'Kirtan, bhajan sandhya, langar and community prayer.',
        glyph: '༄'
    },
    {
        value: 'WEDDING_EXPO',
        label: 'Wedding Expos',
        blurb: 'Every vendor for the big day, under one roof.',
        glyph: '❁'
    },
    {
        value: 'NETWORKING',
        label: 'Networking',
        blurb: 'Founders, creatives and the diaspora professional circuit.',
        glyph: '⌬'
    },
    {
        value: 'SPORTS',
        label: 'Sports',
        blurb: 'Gully cricket leagues, kabaddi and box-league football.',
        glyph: '◈'
    }
]);
/** Category descriptors keyed by enum value for O(1) lookup. */ const CATEGORY_BY_VALUE = new Map(EVENT_CATEGORIES.map((category)=>[
        category.value,
        category
    ]));
/** Fallback used for a category the front end has not been taught yet. */ const UNKNOWN_CATEGORY = Object.freeze({
    value: 'UNKNOWN',
    label: 'Event',
    blurb: 'Something worth turning up to.',
    glyph: '◆'
});
function categoryDescriptor(value) {
    return CATEGORY_BY_VALUE.get(value) ?? UNKNOWN_CATEGORY;
}
function categoryLabel(value) {
    return categoryDescriptor(value).label;
}
function categoriesWithEvents(events) {
    const counts = new Map();
    for (const event of events ?? []){
        counts.set(event.category, (counts.get(event.category) ?? 0) + 1);
    }
    return EVENT_CATEGORIES.filter((category)=>counts.has(category.value)).map((category)=>({
            ...category,
            count: counts.get(category.value)
        }));
}
function describeCategories(facets) {
    const counts = new Map((facets ?? []).map((entry)=>[
            entry.value,
            entry.count
        ]));
    return EVENT_CATEGORIES.filter((category)=>counts.has(category.value)).map((category)=>({
            ...category,
            count: counts.get(category.value)
        }));
}
function citiesWithEvents(events) {
    const cities = new Set((events ?? []).map((event)=>event.city).filter(Boolean));
    return [
        ...cities
    ].sort((a, b)=>a.localeCompare(b));
}
/**
 * Whether an event matches a free-text query.
 *
 * Matching is deliberately generous — title, summary, city, venue and organiser
 * all count — because a visitor searching "garba toronto" is describing an
 * event, not naming one.
 *
 * @param {object} event An event summary.
 * @param {string} query Raw search text.
 * @returns {boolean} True when the event matches.
 */ function matchesQuery(event, query) {
    const needle = query.trim().toLowerCase();
    if (needle === '') return true;
    const haystack = [
        event.title,
        event.summary,
        event.city,
        event.venueName,
        event.organizationName,
        categoryLabel(event.category)
    ].filter(Boolean).join(' ').toLowerCase();
    return needle.split(/\s+/).every((term)=>haystack.includes(term));
}
function filterEvents(events, filters = {}) {
    const { category, city, q } = filters;
    return (events ?? []).filter((event)=>{
        if (category && event.category !== category) return false;
        if (city && event.city !== city) return false;
        if (q && !matchesQuery(event, q)) return false;
        return true;
    });
}
function sortByStartDate(events) {
    return [
        ...events ?? []
    ].sort((a, b)=>Date.parse(a.startsAt) - Date.parse(b.startsAt));
}
}),
"[project]/apps/web/src/lib/search-params.js [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "DEFAULT_PER_PAGE",
    ()=>DEFAULT_PER_PAGE,
    "buildEventsHref",
    ()=>buildEventsHref,
    "hasActiveFilters",
    ()=>hasActiveFilters,
    "paginate",
    ()=>paginate,
    "parseEventFilters",
    ()=>parseEventFilters
]);
/**
 * Reading and writing the listing's filter state, which lives in the URL.
 *
 * The URL is the only store of filter state: it survives a reload, it can be
 * shared, the back button works, and the server component can render the right
 * results on the first response instead of after a round trip. Everything here
 * is pure so both the server page and the client filter form can use it.
 *
 * @module lib/search-params
 */ var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$catalog$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/src/lib/catalog.js [app-rsc] (ecmascript)");
;
const DEFAULT_PER_PAGE = 12;
/** Largest page size a URL may ask for, mirroring the API's own cap. */ const MAX_PER_PAGE = 48;
/** Category values the listing will accept from a URL. */ const KNOWN_CATEGORIES = new Set(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$catalog$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["EVENT_CATEGORIES"].map((category)=>category.value));
/** Longest free-text query accepted, matching `listEventsQuerySchema`. */ const MAX_QUERY_LENGTH = 120;
/**
 * @typedef {object} EventFilters
 * @property {string} category Selected `EventCategory`, or an empty string for all.
 * @property {string} city Selected city, or an empty string for all.
 * @property {string} q Free-text query, trimmed; may be empty.
 * @property {number} page 1-based page number.
 * @property {number} perPage Page size.
 */ /**
 * Read one value out of a Next.js `searchParams` object.
 *
 * A repeated query parameter arrives as an array; the first value wins, because
 * `?city=Mumbai&city=London` is a malformed link rather than a request for two
 * cities.
 *
 * @param {Record<string, string|string[]|undefined>} searchParams Resolved search parameters.
 * @param {string} key Parameter name.
 * @returns {string} The value, trimmed, or an empty string when absent.
 */ function readParam(searchParams, key) {
    const raw = searchParams?.[key];
    const value = Array.isArray(raw) ? raw[0] : raw;
    return typeof value === 'string' ? value.trim() : '';
}
/**
 * Parse a positive integer from a query parameter.
 *
 * @param {string} value Raw parameter value.
 * @param {number} fallback Value used when the parameter is absent or nonsense.
 * @param {number} max Upper bound.
 * @returns {number} A clamped integer.
 */ function readPositiveInt(value, fallback, max) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    return Math.min(parsed, max);
}
function parseEventFilters(searchParams = {}) {
    const category = readParam(searchParams, 'category').toUpperCase();
    return {
        category: KNOWN_CATEGORIES.has(category) ? category : '',
        city: readParam(searchParams, 'city'),
        q: readParam(searchParams, 'q').slice(0, MAX_QUERY_LENGTH),
        page: readPositiveInt(readParam(searchParams, 'page'), 1, 1000),
        perPage: readPositiveInt(readParam(searchParams, 'perPage'), DEFAULT_PER_PAGE, MAX_PER_PAGE)
    };
}
function buildEventsHref(filters = {}) {
    const search = new URLSearchParams();
    if (filters.category) search.set('category', filters.category);
    if (filters.city) search.set('city', filters.city);
    if (filters.q) search.set('q', filters.q);
    if (filters.page && filters.page > 1) search.set('page', String(filters.page));
    if (filters.perPage && filters.perPage !== DEFAULT_PER_PAGE) {
        search.set('perPage', String(filters.perPage));
    }
    const query = search.toString();
    return query === '' ? '/events' : `/events?${query}`;
}
function hasActiveFilters(filters = {}) {
    return Boolean(filters.category || filters.city || filters.q);
}
function paginate(events, { page, perPage }) {
    const all = events ?? [];
    const total = all.length;
    const totalPages = perPage > 0 ? Math.ceil(total / perPage) : 0;
    const safePage = totalPages === 0 ? 1 : Math.min(Math.max(page, 1), totalPages);
    const start = (safePage - 1) * perPage;
    return {
        items: all.slice(start, start + perPage),
        pagination: {
            page: safePage,
            perPage,
            total,
            totalPages,
            hasNextPage: safePage < totalPages,
            hasPreviousPage: safePage > 1 && totalPages > 0
        }
    };
}
}),
"[project]/node_modules/.pnpm/@swc+helpers@0.5.23/node_modules/@swc/helpers/cjs/_interop_require_wildcard.cjs [app-rsc] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

function _getRequireWildcardCache(nodeInterop) {
    if (typeof WeakMap !== "function") return null;
    var cacheBabelInterop = new WeakMap();
    var cacheNodeInterop = new WeakMap();
    return (_getRequireWildcardCache = function(nodeInterop) {
        return nodeInterop ? cacheNodeInterop : cacheBabelInterop;
    })(nodeInterop);
}
function _interop_require_wildcard(obj, nodeInterop) {
    if (!nodeInterop && obj && obj.__esModule) return obj;
    if (obj === null || typeof obj !== "object" && typeof obj !== "function") return {
        default: obj
    };
    var cache = _getRequireWildcardCache(nodeInterop);
    if (cache && cache.has(obj)) return cache.get(obj);
    var newObj = {
        __proto__: null
    };
    var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor;
    for(var key in obj){
        if (key !== "default" && Object.prototype.hasOwnProperty.call(obj, key)) {
            var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null;
            if (desc && (desc.get || desc.set)) Object.defineProperty(newObj, key, desc);
            else newObj[key] = obj[key];
        }
    }
    newObj.default = obj;
    if (cache) cache.set(obj, newObj);
    return newObj;
}
exports._ = _interop_require_wildcard;
}),
"[project]/node_modules/.pnpm/next@16.3.5_@playwright+test@1.63.0_@types+node@26.5.1_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/next/dist/client/app-dir/link.js [app-rsc] (client reference proxy)", ((__turbopack_context__, module, exports) => {

// This file is generated by next-core EcmascriptClientReferenceModule.
const { createClientModuleProxy } = __turbopack_context__.r("[project]/node_modules/.pnpm/next@16.3.5_@playwright+test@1.63.0_@types+node@26.5.1_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-server-dom-turbopack-server.js [app-rsc] (ecmascript)");
__turbopack_context__.n(createClientModuleProxy("[project]/node_modules/.pnpm/next@16.3.5_@playwright+test@1.63.0_@types+node@26.5.1_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/next/dist/client/app-dir/link.js"));
}),
"[project]/node_modules/.pnpm/next@16.3.5_@playwright+test@1.63.0_@types+node@26.5.1_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/next/dist/client/app-dir/link.js [app-rsc] (client reference proxy) <module evaluation>", ((__turbopack_context__, module, exports) => {

// This file is generated by next-core EcmascriptClientReferenceModule.
const { createClientModuleProxy } = __turbopack_context__.r("[project]/node_modules/.pnpm/next@16.3.5_@playwright+test@1.63.0_@types+node@26.5.1_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-server-dom-turbopack-server.js [app-rsc] (ecmascript)");
__turbopack_context__.n(createClientModuleProxy("[project]/node_modules/.pnpm/next@16.3.5_@playwright+test@1.63.0_@types+node@26.5.1_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/next/dist/client/app-dir/link.js <module evaluation>"));
}),
"[project]/node_modules/.pnpm/next@16.3.5_@playwright+test@1.63.0_@types+node@26.5.1_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/next/dist/client/app-dir/link.js [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$client$2f$app$2d$dir$2f$link$2e$js__$5b$app$2d$rsc$5d$__$28$client__reference__proxy$29$__$3c$module__evaluation$3e$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@16.3.5_@playwright+test@1.63.0_@types+node@26.5.1_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/next/dist/client/app-dir/link.js [app-rsc] (client reference proxy) <module evaluation>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$client$2f$app$2d$dir$2f$link$2e$js__$5b$app$2d$rsc$5d$__$28$client__reference__proxy$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@16.3.5_@playwright+test@1.63.0_@types+node@26.5.1_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/next/dist/client/app-dir/link.js [app-rsc] (client reference proxy)");
;
__turbopack_context__.n(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$client$2f$app$2d$dir$2f$link$2e$js__$5b$app$2d$rsc$5d$__$28$client__reference__proxy$29$__);
}),
"[project]/node_modules/.pnpm/next@16.3.5_@playwright+test@1.63.0_@types+node@26.5.1_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/next/dist/client/app-dir/link.react-server.js [app-rsc] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    default: null,
    useLinkStatus: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    default: function() {
        return LinkComponent;
    },
    useLinkStatus: function() {
        return _link.useLinkStatus;
    }
});
const _interop_require_wildcard = __turbopack_context__.r("[project]/node_modules/.pnpm/@swc+helpers@0.5.23/node_modules/@swc/helpers/cjs/_interop_require_wildcard.cjs [app-rsc] (ecmascript)");
const _jsxruntime = __turbopack_context__.r("[project]/node_modules/.pnpm/next@16.3.5_@playwright+test@1.63.0_@types+node@26.5.1_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-jsx-runtime.js [app-rsc] (ecmascript)");
const _link = /*#__PURE__*/ _interop_require_wildcard._(__turbopack_context__.r("[project]/node_modules/.pnpm/next@16.3.5_@playwright+test@1.63.0_@types+node@26.5.1_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/next/dist/client/app-dir/link.js [app-rsc] (ecmascript)"));
function LinkComponent(props) {
    const isLegacyBehavior = props.legacyBehavior;
    const childIsHostComponent = typeof props.children === 'string' || typeof props.children === 'number' || typeof props.children?.type === 'string';
    const childIsClientComponent = props.children?.type?.$$typeof === Symbol.for('react.client.reference');
    if (isLegacyBehavior && !childIsHostComponent && !childIsClientComponent) {
        if (props.children?.type?.$$typeof === Symbol.for('react.lazy')) {
            console.error(`Using a Lazy Component as a direct child of \`<Link legacyBehavior>\` from a Server Component is not supported. If you need legacyBehavior, wrap your Lazy Component in a Client Component that renders the Link's \`<a>\` tag.`);
        } else {
            console.error(`Using a Server Component as a direct child of \`<Link legacyBehavior>\` is not supported. If you need legacyBehavior, wrap your Server Component in a Client Component that renders the Link's \`<a>\` tag.`);
        }
    }
    return /*#__PURE__*/ (0, _jsxruntime.jsx)(_link.default, {
        ...props
    });
}
if ((typeof exports.default === 'function' || typeof exports.default === 'object' && exports.default !== null) && typeof exports.default.__esModule === 'undefined') {
    Object.defineProperty(exports.default, '__esModule', {
        value: true
    });
    Object.assign(exports.default, exports);
    module.exports = exports.default;
}
}),
"[project]/node_modules/.pnpm/next@16.3.5_@playwright+test@1.63.0_@types+node@26.5.1_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-jsx-dev-runtime.js [app-rsc] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

module.exports = __turbopack_context__.r("[project]/node_modules/.pnpm/next@16.3.5_@playwright+test@1.63.0_@types+node@26.5.1_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/next/dist/server/route-modules/app-page/module.compiled.js [app-rsc] (ecmascript)").vendored['react-rsc'].ReactJsxDevRuntime;
}),
];

//# sourceMappingURL=_1mh7mgm._.js.map