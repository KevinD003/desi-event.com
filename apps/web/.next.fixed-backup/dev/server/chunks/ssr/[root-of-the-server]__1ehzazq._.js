module.exports = [
"[externals]/next/dist/shared/lib/no-fallback-error.external.js [external] (next/dist/shared/lib/no-fallback-error.external.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/shared/lib/no-fallback-error.external.js", () => require("next/dist/shared/lib/no-fallback-error.external.js"));

module.exports = mod;
}),
"[project]/apps/web/src/app/events/page.jsx [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "default",
    ()=>EventsPage,
    "dynamic",
    ()=>dynamic,
    "metadata",
    ()=>metadata
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@16.3.5_@playwright+test@1.63.0_@types+node@26.5.1_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-jsx-dev-runtime.js [app-rsc] (ecmascript)");
/**
 * The event listing: filter by category, city and free text.
 *
 * All filter state lives in the query string, so the server renders the right
 * results on the first response, the back button behaves, and a filtered view
 * can be shared as a link. `searchParams` is a promise in the App Router and
 * must be awaited before it is read.
 *
 * @module app/events/page
 */ var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$client$2f$app$2d$dir$2f$link$2e$react$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@16.3.5_@playwright+test@1.63.0_@types+node@26.5.1_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/next/dist/client/app-dir/link.react-server.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$components$2f$ui$2e$jsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/src/components/ui.jsx [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$api$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/apps/web/src/lib/api.js [app-rsc] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$catalog$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/src/lib/catalog.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$search$2d$params$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/src/lib/search-params.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$components$2f$listing$2d$filters$2e$jsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/src/components/listing-filters.jsx [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$components$2f$listing$2d$card$2e$jsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/src/components/listing-card.jsx [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$components$2f$sample$2d$data$2d$notice$2e$jsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/src/components/sample-data-notice.jsx [app-rsc] (ecmascript)");
;
;
;
;
;
;
;
;
;
const dynamic = 'force-dynamic';
const metadata = {
    title: 'All events',
    description: 'Every garba night, qawwali mehfil, mela, film retrospective and comedy show on Desi-Event — filter by category, city or search.'
};
/**
 * Describe the current result set in one sentence.
 *
 * @param {object} pagination Page counters from the listing.
 * @param {object} filters Active filters.
 * @returns {string} A sentence such as `3 events in Toronto`.
 */ function resultSummary(pagination, filters) {
    const noun = pagination.total === 1 ? 'event' : 'events';
    const where = filters.city ? ` in ${filters.city}` : '';
    const matching = filters.q ? ` matching “${filters.q}”` : '';
    return `${pagination.total} ${noun}${where}${matching}`;
}
async function EventsPage({ searchParams }) {
    const filters = (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$search$2d$params$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["parseEventFilters"])(await searchParams);
    // The filter selects offer every category and city the catalogue has, not
    // just the ones surviving the current filter — otherwise choosing "Toronto"
    // would delete every other city from the city select.
    //
    // They come from facet counts computed in the database over every published
    // event, not from a page of results. Deriving them from one page meant a city
    // whose events all started later than the forty-eighth was absent from the
    // select entirely, and its events unreachable through filtering.
    const [listing, facetResult] = await Promise.all([
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$api$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$locals$3e$__["loadEventList"])(filters),
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$api$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$locals$3e$__["loadCatalogueFacets"])()
    ]);
    const { events, pagination, usedFallback } = listing;
    const categories = (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$catalog$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["describeCategories"])(facetResult.facets.categories);
    const cities = facetResult.facets.cities.map((entry)=>entry.value);
    const active = (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$search$2d$params$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["hasActiveFilters"])(filters);
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        className: "mx-auto max-w-6xl px-4 py-10",
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("h1", {
                className: "text-3xl font-bold text-indigo-night-900 sm:text-4xl",
                children: "What’s on"
            }, void 0, false, {
                fileName: "[project]/apps/web/src/app/events/page.jsx",
                lineNumber: 76,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                className: "mt-2 max-w-2xl text-slate-700",
                children: "Ten cities’ worth of ambition, four cities’ worth of listings. Filter it down to the night you actually want."
            }, void 0, false, {
                fileName: "[project]/apps/web/src/app/events/page.jsx",
                lineNumber: 77,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "mt-6",
                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$components$2f$listing$2d$filters$2e$jsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["EventFilters"], {
                    categories: categories,
                    cities: cities,
                    filters: filters,
                    anyActive: active,
                    resultCount: pagination?.total ?? events.length
                }, void 0, false, {
                    fileName: "[project]/apps/web/src/app/events/page.jsx",
                    lineNumber: 88,
                    columnNumber: 9
                }, this)
            }, void 0, false, {
                fileName: "[project]/apps/web/src/app/events/page.jsx",
                lineNumber: 82,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$components$2f$sample$2d$data$2d$notice$2e$jsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["SampleDataNotice"], {
                show: usedFallback
            }, void 0, false, {
                fileName: "[project]/apps/web/src/app/events/page.jsx",
                lineNumber: 97,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                role: "status",
                "data-testid": "result-count",
                className: "mt-6 text-sm font-medium text-slate-600",
                children: resultSummary(pagination, filters)
            }, void 0, false, {
                fileName: "[project]/apps/web/src/app/events/page.jsx",
                lineNumber: 99,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                id: "event-results",
                tabIndex: -1,
                className: "mt-4 scroll-mt-4",
                children: events.length === 0 ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$components$2f$ui$2e$jsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["EmptyState"], {
                    icon: "◎",
                    title: "Nothing matches that yet",
                    description: "Try a broader search, another city, or browse everything we have on.",
                    action: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$client$2f$app$2d$dir$2f$link$2e$react$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["default"], {
                        href: "/events",
                        className: "inline-flex h-10 items-center justify-center rounded-lg bg-marigold-600 px-4 text-sm font-medium text-white transition-colors hover:bg-marigold-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marigold-500 focus-visible:ring-offset-2",
                        children: "Clear all filters"
                    }, void 0, false, {
                        fileName: "[project]/apps/web/src/app/events/page.jsx",
                        lineNumber: 120,
                        columnNumber: 15
                    }, this)
                }, void 0, false, {
                    fileName: "[project]/apps/web/src/app/events/page.jsx",
                    lineNumber: 115,
                    columnNumber: 11
                }, this) : /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$components$2f$listing$2d$card$2e$jsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["EventGrid"], {
                    events: events,
                    label: "Matching events",
                    headingLevel: "h2"
                }, void 0, false, {
                    fileName: "[project]/apps/web/src/app/events/page.jsx",
                    lineNumber: 129,
                    columnNumber: 11
                }, this)
            }, void 0, false, {
                fileName: "[project]/apps/web/src/app/events/page.jsx",
                lineNumber: 113,
                columnNumber: 7
            }, this),
            pagination.totalPages > 1 ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("nav", {
                "aria-label": "Listing pages",
                className: "mt-10 flex items-center justify-between gap-4",
                children: [
                    pagination.hasPreviousPage ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$client$2f$app$2d$dir$2f$link$2e$react$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["default"], {
                        href: (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$search$2d$params$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["buildEventsHref"])({
                            ...filters,
                            page: pagination.page - 1
                        }),
                        className: "rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marigold-500 focus-visible:ring-offset-2",
                        children: "← Previous"
                    }, void 0, false, {
                        fileName: "[project]/apps/web/src/app/events/page.jsx",
                        lineNumber: 136,
                        columnNumber: 13
                    }, this) : /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {}, void 0, false, {
                        fileName: "[project]/apps/web/src/app/events/page.jsx",
                        lineNumber: 143,
                        columnNumber: 13
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                        className: "text-sm text-slate-600",
                        children: [
                            "Page ",
                            pagination.page,
                            " of ",
                            pagination.totalPages
                        ]
                    }, void 0, true, {
                        fileName: "[project]/apps/web/src/app/events/page.jsx",
                        lineNumber: 146,
                        columnNumber: 11
                    }, this),
                    pagination.hasNextPage ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$client$2f$app$2d$dir$2f$link$2e$react$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["default"], {
                        href: (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$search$2d$params$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["buildEventsHref"])({
                            ...filters,
                            page: pagination.page + 1
                        }),
                        className: "rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marigold-500 focus-visible:ring-offset-2",
                        children: "Next →"
                    }, void 0, false, {
                        fileName: "[project]/apps/web/src/app/events/page.jsx",
                        lineNumber: 151,
                        columnNumber: 13
                    }, this) : /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {}, void 0, false, {
                        fileName: "[project]/apps/web/src/app/events/page.jsx",
                        lineNumber: 158,
                        columnNumber: 13
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/apps/web/src/app/events/page.jsx",
                lineNumber: 134,
                columnNumber: 9
            }, this) : null
        ]
    }, void 0, true, {
        fileName: "[project]/apps/web/src/app/events/page.jsx",
        lineNumber: 75,
        columnNumber: 5
    }, this);
}
}),
"[project]/apps/web/src/app/events/page.jsx [app-rsc] (ecmascript, Next.js Server Component)", (function(__turbopack_context__){

__turbopack_context__.n(__turbopack_context__.i("[project]/apps/web/src/app/events/page.jsx [app-rsc] (ecmascript)"));
}),
"[project]/apps/web/src/components/listing-card.jsx [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "EventCard",
    ()=>EventCard,
    "EventGrid",
    ()=>EventGrid
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@16.3.5_@playwright+test@1.63.0_@types+node@26.5.1_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-jsx-dev-runtime.js [app-rsc] (ecmascript)");
/**
 * A single event in a listing grid.
 *
 * The whole card is clickable but there is exactly one link in it: the title
 * link is stretched over the card with a pseudo-element. Wrapping the card in a
 * link instead would give a screen reader user one enormous link whose
 * accessible name is the entire card, and adding a second "View" link would
 * make every card appear twice in the links list.
 *
 * @module components/listing-card
 */ var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$client$2f$app$2d$dir$2f$link$2e$react$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@16.3.5_@playwright+test@1.63.0_@types+node@26.5.1_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/next/dist/client/app-dir/link.react-server.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$components$2f$ui$2e$jsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/src/components/ui.jsx [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$catalog$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/src/lib/catalog.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$format$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/src/lib/format.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$pricing$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/apps/web/src/lib/pricing.js [app-rsc] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$components$2f$motion$2e$jsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/src/components/motion.jsx [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$components$2f$poster$2e$jsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/src/components/poster.jsx [app-rsc] (ecmascript)");
;
;
;
;
;
;
;
;
function EventCard({ event, index = 0, headingLevel: Heading = 'h3' }) {
    const priceLabel = event.minPriceCents == null ? 'Price to be announced' : (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$pricing$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$locals$3e$__["formatPrice"])(event.minPriceCents, event.currency ?? 'INR');
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$components$2f$motion$2e$jsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["RevealOnScroll"], {
        as: "li",
        index: index,
        className: "h-full",
        children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$components$2f$motion$2e$jsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["HoverLift"], {
            className: "h-full",
            children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$components$2f$ui$2e$jsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["Card"], {
                as: "article",
                interactive: true,
                className: "relative flex h-full flex-col overflow-hidden bg-white",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$components$2f$poster$2e$jsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["EventPoster"], {
                        event: event
                    }, void 0, false, {
                        fileName: "[project]/apps/web/src/components/listing-card.jsx",
                        lineNumber: 54,
                        columnNumber: 11
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$components$2f$ui$2e$jsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["CardBody"], {
                        className: "flex flex-1 flex-col gap-2.5",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                className: "flex flex-wrap items-center gap-2",
                                children: [
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$components$2f$ui$2e$jsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["Badge"], {
                                        variant: "brand",
                                        children: (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$catalog$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["categoryLabel"])(event.category)
                                    }, void 0, false, {
                                        fileName: "[project]/apps/web/src/components/listing-card.jsx",
                                        lineNumber: 58,
                                        columnNumber: 15
                                    }, this),
                                    event.soldOut ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$components$2f$ui$2e$jsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["Badge"], {
                                        variant: "danger",
                                        srLabel: "Availability:",
                                        children: "Sold out"
                                    }, void 0, false, {
                                        fileName: "[project]/apps/web/src/components/listing-card.jsx",
                                        lineNumber: 60,
                                        columnNumber: 17
                                    }, this) : null,
                                    event.isOnline ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$components$2f$ui$2e$jsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["Badge"], {
                                        variant: "info",
                                        children: "Online"
                                    }, void 0, false, {
                                        fileName: "[project]/apps/web/src/components/listing-card.jsx",
                                        lineNumber: 64,
                                        columnNumber: 33
                                    }, this) : null
                                ]
                            }, void 0, true, {
                                fileName: "[project]/apps/web/src/components/listing-card.jsx",
                                lineNumber: 57,
                                columnNumber: 13
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(Heading, {
                                className: "font-display text-lg leading-snug font-semibold text-indigo-night-900",
                                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$client$2f$app$2d$dir$2f$link$2e$react$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["default"], {
                                    href: `/events/${event.slug}`,
                                    className: "rounded-sm after:absolute after:inset-0 after:content-[''] hover:text-marigold-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marigold-500 focus-visible:ring-offset-2",
                                    children: event.title
                                }, void 0, false, {
                                    fileName: "[project]/apps/web/src/components/listing-card.jsx",
                                    lineNumber: 68,
                                    columnNumber: 15
                                }, this)
                            }, void 0, false, {
                                fileName: "[project]/apps/web/src/components/listing-card.jsx",
                                lineNumber: 67,
                                columnNumber: 13
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                                className: "line-clamp-3 text-sm text-slate-600",
                                children: event.summary
                            }, void 0, false, {
                                fileName: "[project]/apps/web/src/components/listing-card.jsx",
                                lineNumber: 76,
                                columnNumber: 13
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("dl", {
                                className: "mt-auto space-y-1 pt-2 text-sm text-slate-700",
                                children: [
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                        className: "flex gap-2",
                                        children: [
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("dt", {
                                                className: "sr-only",
                                                children: "Date"
                                            }, void 0, false, {
                                                fileName: "[project]/apps/web/src/components/listing-card.jsx",
                                                lineNumber: 80,
                                                columnNumber: 17
                                            }, this),
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("dd", {
                                                children: [
                                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("time", {
                                                        dateTime: (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$format$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["toDateTimeAttribute"])(event.startsAt),
                                                        children: (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$format$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["formatEventDate"])(event.startsAt, event.timezone)
                                                    }, void 0, false, {
                                                        fileName: "[project]/apps/web/src/components/listing-card.jsx",
                                                        lineNumber: 82,
                                                        columnNumber: 19
                                                    }, this),
                                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                        "aria-hidden": "true",
                                                        children: " · "
                                                    }, void 0, false, {
                                                        fileName: "[project]/apps/web/src/components/listing-card.jsx",
                                                        lineNumber: 85,
                                                        columnNumber: 19
                                                    }, this),
                                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                        children: (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$format$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["formatEventTime"])(event.startsAt, event.timezone)
                                                    }, void 0, false, {
                                                        fileName: "[project]/apps/web/src/components/listing-card.jsx",
                                                        lineNumber: 86,
                                                        columnNumber: 19
                                                    }, this)
                                                ]
                                            }, void 0, true, {
                                                fileName: "[project]/apps/web/src/components/listing-card.jsx",
                                                lineNumber: 81,
                                                columnNumber: 17
                                            }, this)
                                        ]
                                    }, void 0, true, {
                                        fileName: "[project]/apps/web/src/components/listing-card.jsx",
                                        lineNumber: 79,
                                        columnNumber: 15
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                        className: "flex gap-2",
                                        children: [
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("dt", {
                                                className: "sr-only",
                                                children: "Location"
                                            }, void 0, false, {
                                                fileName: "[project]/apps/web/src/components/listing-card.jsx",
                                                lineNumber: 90,
                                                columnNumber: 17
                                            }, this),
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("dd", {
                                                className: "text-slate-600",
                                                children: (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$format$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["formatEventLocation"])(event)
                                            }, void 0, false, {
                                                fileName: "[project]/apps/web/src/components/listing-card.jsx",
                                                lineNumber: 91,
                                                columnNumber: 17
                                            }, this)
                                        ]
                                    }, void 0, true, {
                                        fileName: "[project]/apps/web/src/components/listing-card.jsx",
                                        lineNumber: 89,
                                        columnNumber: 15
                                    }, this)
                                ]
                            }, void 0, true, {
                                fileName: "[project]/apps/web/src/components/listing-card.jsx",
                                lineNumber: 78,
                                columnNumber: 13
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/apps/web/src/components/listing-card.jsx",
                        lineNumber: 56,
                        columnNumber: 11
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$components$2f$ui$2e$jsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["CardFooter"], {
                        className: "justify-between bg-marigold-50/60",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                                className: "text-sm text-slate-700",
                                children: [
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                        className: "text-slate-500",
                                        children: "From "
                                    }, void 0, false, {
                                        fileName: "[project]/apps/web/src/components/listing-card.jsx",
                                        lineNumber: 98,
                                        columnNumber: 15
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                        className: "font-semibold text-indigo-night-900",
                                        children: priceLabel
                                    }, void 0, false, {
                                        fileName: "[project]/apps/web/src/components/listing-card.jsx",
                                        lineNumber: 99,
                                        columnNumber: 15
                                    }, this)
                                ]
                            }, void 0, true, {
                                fileName: "[project]/apps/web/src/components/listing-card.jsx",
                                lineNumber: 97,
                                columnNumber: 13
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                "aria-hidden": "true",
                                className: "text-sm font-medium text-marigold-700",
                                children: "Details →"
                            }, void 0, false, {
                                fileName: "[project]/apps/web/src/components/listing-card.jsx",
                                lineNumber: 101,
                                columnNumber: 13
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/apps/web/src/components/listing-card.jsx",
                        lineNumber: 96,
                        columnNumber: 11
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/apps/web/src/components/listing-card.jsx",
                lineNumber: 49,
                columnNumber: 9
            }, this)
        }, void 0, false, {
            fileName: "[project]/apps/web/src/components/listing-card.jsx",
            lineNumber: 48,
            columnNumber: 7
        }, this)
    }, void 0, false, {
        fileName: "[project]/apps/web/src/components/listing-card.jsx",
        lineNumber: 47,
        columnNumber: 5
    }, this);
}
function EventGrid({ events, label, headingLevel = 'h3' }) {
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("ul", {
        "aria-label": label,
        className: "grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3",
        children: events.map((event, index)=>/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(EventCard, {
                event: event,
                index: index,
                headingLevel: headingLevel
            }, event.id ?? event.slug, false, {
                fileName: "[project]/apps/web/src/components/listing-card.jsx",
                lineNumber: 131,
                columnNumber: 9
            }, this))
    }, void 0, false, {
        fileName: "[project]/apps/web/src/components/listing-card.jsx",
        lineNumber: 129,
        columnNumber: 5
    }, this);
}
}),
"[project]/apps/web/src/components/listing-filters.jsx [app-rsc] (client reference proxy)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "EventFilters",
    ()=>EventFilters
]);
// This file is generated by next-core EcmascriptClientReferenceModule.
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@16.3.5_@playwright+test@1.63.0_@types+node@26.5.1_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-server-dom-turbopack-server.js [app-rsc] (ecmascript)");
;
const EventFilters = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call EventFilters() from the server but EventFilters is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/apps/web/src/components/listing-filters.jsx", "EventFilters");
}),
"[project]/apps/web/src/components/listing-filters.jsx [app-rsc] (client reference proxy) <module evaluation>", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "EventFilters",
    ()=>EventFilters
]);
// This file is generated by next-core EcmascriptClientReferenceModule.
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@16.3.5_@playwright+test@1.63.0_@types+node@26.5.1_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-server-dom-turbopack-server.js [app-rsc] (ecmascript)");
;
const EventFilters = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call EventFilters() from the server but EventFilters is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/apps/web/src/components/listing-filters.jsx <module evaluation>", "EventFilters");
}),
"[project]/apps/web/src/components/listing-filters.jsx [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$components$2f$listing$2d$filters$2e$jsx__$5b$app$2d$rsc$5d$__$28$client__reference__proxy$29$__$3c$module__evaluation$3e$__ = __turbopack_context__.i("[project]/apps/web/src/components/listing-filters.jsx [app-rsc] (client reference proxy) <module evaluation>");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$components$2f$listing$2d$filters$2e$jsx__$5b$app$2d$rsc$5d$__$28$client__reference__proxy$29$__ = __turbopack_context__.i("[project]/apps/web/src/components/listing-filters.jsx [app-rsc] (client reference proxy)");
;
__turbopack_context__.n(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$components$2f$listing$2d$filters$2e$jsx__$5b$app$2d$rsc$5d$__$28$client__reference__proxy$29$__);
}),
"[project]/apps/web/src/components/motion.jsx [app-rsc] (client reference proxy)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "FadeIn",
    ()=>FadeIn,
    "HoverLift",
    ()=>HoverLift,
    "RevealOnScroll",
    ()=>RevealOnScroll
]);
// This file is generated by next-core EcmascriptClientReferenceModule.
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@16.3.5_@playwright+test@1.63.0_@types+node@26.5.1_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-server-dom-turbopack-server.js [app-rsc] (ecmascript)");
;
const FadeIn = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call FadeIn() from the server but FadeIn is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/apps/web/src/components/motion.jsx", "FadeIn");
const HoverLift = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call HoverLift() from the server but HoverLift is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/apps/web/src/components/motion.jsx", "HoverLift");
const RevealOnScroll = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call RevealOnScroll() from the server but RevealOnScroll is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/apps/web/src/components/motion.jsx", "RevealOnScroll");
}),
"[project]/apps/web/src/components/motion.jsx [app-rsc] (client reference proxy) <module evaluation>", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "FadeIn",
    ()=>FadeIn,
    "HoverLift",
    ()=>HoverLift,
    "RevealOnScroll",
    ()=>RevealOnScroll
]);
// This file is generated by next-core EcmascriptClientReferenceModule.
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@16.3.5_@playwright+test@1.63.0_@types+node@26.5.1_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-server-dom-turbopack-server.js [app-rsc] (ecmascript)");
;
const FadeIn = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call FadeIn() from the server but FadeIn is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/apps/web/src/components/motion.jsx <module evaluation>", "FadeIn");
const HoverLift = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call HoverLift() from the server but HoverLift is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/apps/web/src/components/motion.jsx <module evaluation>", "HoverLift");
const RevealOnScroll = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call RevealOnScroll() from the server but RevealOnScroll is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/apps/web/src/components/motion.jsx <module evaluation>", "RevealOnScroll");
}),
"[project]/apps/web/src/components/motion.jsx [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$components$2f$motion$2e$jsx__$5b$app$2d$rsc$5d$__$28$client__reference__proxy$29$__$3c$module__evaluation$3e$__ = __turbopack_context__.i("[project]/apps/web/src/components/motion.jsx [app-rsc] (client reference proxy) <module evaluation>");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$components$2f$motion$2e$jsx__$5b$app$2d$rsc$5d$__$28$client__reference__proxy$29$__ = __turbopack_context__.i("[project]/apps/web/src/components/motion.jsx [app-rsc] (client reference proxy)");
;
__turbopack_context__.n(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$components$2f$motion$2e$jsx__$5b$app$2d$rsc$5d$__$28$client__reference__proxy$29$__);
}),
"[project]/apps/web/src/components/poster.jsx [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "EventPoster",
    ()=>EventPoster
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@16.3.5_@playwright+test@1.63.0_@types+node@26.5.1_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-jsx-dev-runtime.js [app-rsc] (ecmascript)");
/**
 * The poster block that stands in for an event's cover image.
 *
 * Deliberately an inline SVG rather than an `<img>`: the fallback catalogue has
 * no hosted artwork, a remote image would make every page depend on a third
 * party being up, and a broken image is a worse first impression than none. The
 * SVG carries `role="img"` and an `aria-label`, so it is announced exactly as a
 * photograph with alt text would be.
 *
 * The colours are derived from the event slug, so a given event always gets the
 * same poster — recognisable across the listing, the detail page and checkout.
 *
 * @module components/poster
 */ var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$catalog$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/src/lib/catalog.js [app-rsc] (ecmascript)");
;
;
/**
 * Marigold-to-indigo gradient pairs from the shared theme, as raw colour
 * values because an SVG gradient stop cannot take a Tailwind class.
 */ const PALETTES = [
    [
        'oklch(0.806 0.172 76.1)',
        'oklch(0.567 0.148 48.6)'
    ],
    [
        'oklch(0.751 0.176 70.3)',
        'oklch(0.417 0.161 288.1)'
    ],
    [
        'oklch(0.862 0.152 80.4)',
        'oklch(0.462 0.101 153.8)'
    ],
    [
        'oklch(0.672 0.169 58.7)',
        'oklch(0.283 0.106 288.7)'
    ],
    [
        'oklch(0.612 0.128 152.4)',
        'oklch(0.213 0.076 289.4)'
    ]
];
/**
 * Pick a stable palette for a string.
 *
 * @param {string} seed Stable identifier, normally the event slug.
 * @returns {string[]} A `[from, to]` pair of colour values.
 */ function paletteFor(seed) {
    let hash = 0;
    for(let index = 0; index < seed.length; index += 1){
        hash = (hash * 31 + seed.charCodeAt(index)) % 100_000;
    }
    return PALETTES[hash % PALETTES.length];
}
function EventPoster({ event, variant = 'card', className }) {
    const seed = event?.slug ?? event?.id ?? 'desi-event';
    const [from, to] = paletteFor(seed);
    const { glyph, label } = (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$catalog$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["categoryDescriptor"])(event?.category);
    const gradientId = `poster-gradient-${seed}`;
    const isHero = variant === 'hero';
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("svg", {
        role: "img",
        "aria-label": `${label} poster for ${event?.title ?? 'this event'}`,
        viewBox: "0 0 400 225",
        preserveAspectRatio: "xMidYMid slice",
        className: [
            'block aspect-[16/9] w-full',
            isHero ? 'max-h-80' : '',
            className
        ].filter(Boolean).join(' '),
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("defs", {
                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("linearGradient", {
                    id: gradientId,
                    x1: "0",
                    y1: "0",
                    x2: "1",
                    y2: "1",
                    children: [
                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("stop", {
                            offset: "0%",
                            stopColor: from
                        }, void 0, false, {
                            fileName: "[project]/apps/web/src/components/poster.jsx",
                            lineNumber: 78,
                            columnNumber: 11
                        }, this),
                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("stop", {
                            offset: "100%",
                            stopColor: to
                        }, void 0, false, {
                            fileName: "[project]/apps/web/src/components/poster.jsx",
                            lineNumber: 79,
                            columnNumber: 11
                        }, this)
                    ]
                }, void 0, true, {
                    fileName: "[project]/apps/web/src/components/poster.jsx",
                    lineNumber: 77,
                    columnNumber: 9
                }, this)
            }, void 0, false, {
                fileName: "[project]/apps/web/src/components/poster.jsx",
                lineNumber: 76,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("rect", {
                width: "400",
                height: "225",
                fill: `url(#${gradientId})`
            }, void 0, false, {
                fileName: "[project]/apps/web/src/components/poster.jsx",
                lineNumber: 82,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("g", {
                fill: "none",
                stroke: "#ffffff",
                strokeOpacity: "0.22",
                strokeWidth: "1.5",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("circle", {
                        cx: "330",
                        cy: "40",
                        r: "26"
                    }, void 0, false, {
                        fileName: "[project]/apps/web/src/components/poster.jsx",
                        lineNumber: 85,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("circle", {
                        cx: "330",
                        cy: "40",
                        r: "44"
                    }, void 0, false, {
                        fileName: "[project]/apps/web/src/components/poster.jsx",
                        lineNumber: 86,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("circle", {
                        cx: "330",
                        cy: "40",
                        r: "62"
                    }, void 0, false, {
                        fileName: "[project]/apps/web/src/components/poster.jsx",
                        lineNumber: 87,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("circle", {
                        cx: "52",
                        cy: "196",
                        r: "20"
                    }, void 0, false, {
                        fileName: "[project]/apps/web/src/components/poster.jsx",
                        lineNumber: 88,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("circle", {
                        cx: "52",
                        cy: "196",
                        r: "36"
                    }, void 0, false, {
                        fileName: "[project]/apps/web/src/components/poster.jsx",
                        lineNumber: 89,
                        columnNumber: 9
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/apps/web/src/components/poster.jsx",
                lineNumber: 84,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("text", {
                x: "28",
                y: "150",
                fill: "#ffffff",
                fillOpacity: "0.92",
                fontSize: "72",
                fontFamily: "Georgia, 'Times New Roman', serif",
                children: glyph
            }, void 0, false, {
                fileName: "[project]/apps/web/src/components/poster.jsx",
                lineNumber: 91,
                columnNumber: 7
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/apps/web/src/components/poster.jsx",
        lineNumber: 67,
        columnNumber: 5
    }, this);
}
}),
"[project]/apps/web/src/components/sample-data-notice.jsx [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "SampleDataNotice",
    ()=>SampleDataNotice
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@16.3.5_@playwright+test@1.63.0_@types+node@26.5.1_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-jsx-dev-runtime.js [app-rsc] (ecmascript)");
/**
 * The note shown when the page is rendering the curated catalogue because the
 * live API could not be reached.
 *
 * Saying so is the honest option. The alternative — showing sample listings as
 * though they were on sale — would eventually sell somebody a ticket to an
 * event that does not exist.
 *
 * @module components/sample-data-notice
 */ var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$components$2f$ui$2e$jsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/src/components/ui.jsx [app-rsc] (ecmascript)");
;
;
function SampleDataNotice({ show }) {
    if (!show) return null;
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$components$2f$ui$2e$jsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["Alert"], {
        variant: "info",
        title: "Showing our sample programme",
        className: "mt-6",
        children: "The live listings service is not answering right now, so these are curated example events. Prices and availability are illustrative and nothing here can be bought."
    }, void 0, false, {
        fileName: "[project]/apps/web/src/components/sample-data-notice.jsx",
        lineNumber: 29,
        columnNumber: 5
    }, this);
}
}),
"[project]/apps/web/src/components/ui.jsx [app-rsc] (client reference proxy)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "Alert",
    ()=>Alert,
    "Badge",
    ()=>Badge,
    "Button",
    ()=>Button,
    "Card",
    ()=>Card,
    "CardBody",
    ()=>CardBody,
    "CardFooter",
    ()=>CardFooter,
    "CardHeader",
    ()=>CardHeader,
    "EmptyState",
    ()=>EmptyState,
    "FormField",
    ()=>FormField,
    "Input",
    ()=>Input,
    "Select",
    ()=>Select
]);
// This file is generated by next-core EcmascriptClientReferenceModule.
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@16.3.5_@playwright+test@1.63.0_@types+node@26.5.1_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-server-dom-turbopack-server.js [app-rsc] (ecmascript)");
;
const Alert = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call Alert() from the server but Alert is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/apps/web/src/components/ui.jsx", "Alert");
const Badge = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call Badge() from the server but Badge is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/apps/web/src/components/ui.jsx", "Badge");
const Button = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call Button() from the server but Button is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/apps/web/src/components/ui.jsx", "Button");
const Card = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call Card() from the server but Card is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/apps/web/src/components/ui.jsx", "Card");
const CardBody = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call CardBody() from the server but CardBody is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/apps/web/src/components/ui.jsx", "CardBody");
const CardFooter = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call CardFooter() from the server but CardFooter is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/apps/web/src/components/ui.jsx", "CardFooter");
const CardHeader = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call CardHeader() from the server but CardHeader is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/apps/web/src/components/ui.jsx", "CardHeader");
const EmptyState = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call EmptyState() from the server but EmptyState is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/apps/web/src/components/ui.jsx", "EmptyState");
const FormField = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call FormField() from the server but FormField is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/apps/web/src/components/ui.jsx", "FormField");
const Input = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call Input() from the server but Input is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/apps/web/src/components/ui.jsx", "Input");
const Select = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call Select() from the server but Select is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/apps/web/src/components/ui.jsx", "Select");
}),
"[project]/apps/web/src/components/ui.jsx [app-rsc] (client reference proxy) <module evaluation>", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "Alert",
    ()=>Alert,
    "Badge",
    ()=>Badge,
    "Button",
    ()=>Button,
    "Card",
    ()=>Card,
    "CardBody",
    ()=>CardBody,
    "CardFooter",
    ()=>CardFooter,
    "CardHeader",
    ()=>CardHeader,
    "EmptyState",
    ()=>EmptyState,
    "FormField",
    ()=>FormField,
    "Input",
    ()=>Input,
    "Select",
    ()=>Select
]);
// This file is generated by next-core EcmascriptClientReferenceModule.
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@16.3.5_@playwright+test@1.63.0_@types+node@26.5.1_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-server-dom-turbopack-server.js [app-rsc] (ecmascript)");
;
const Alert = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call Alert() from the server but Alert is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/apps/web/src/components/ui.jsx <module evaluation>", "Alert");
const Badge = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call Badge() from the server but Badge is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/apps/web/src/components/ui.jsx <module evaluation>", "Badge");
const Button = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call Button() from the server but Button is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/apps/web/src/components/ui.jsx <module evaluation>", "Button");
const Card = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call Card() from the server but Card is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/apps/web/src/components/ui.jsx <module evaluation>", "Card");
const CardBody = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call CardBody() from the server but CardBody is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/apps/web/src/components/ui.jsx <module evaluation>", "CardBody");
const CardFooter = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call CardFooter() from the server but CardFooter is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/apps/web/src/components/ui.jsx <module evaluation>", "CardFooter");
const CardHeader = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call CardHeader() from the server but CardHeader is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/apps/web/src/components/ui.jsx <module evaluation>", "CardHeader");
const EmptyState = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call EmptyState() from the server but EmptyState is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/apps/web/src/components/ui.jsx <module evaluation>", "EmptyState");
const FormField = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call FormField() from the server but FormField is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/apps/web/src/components/ui.jsx <module evaluation>", "FormField");
const Input = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call Input() from the server but Input is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/apps/web/src/components/ui.jsx <module evaluation>", "Input");
const Select = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call Select() from the server but Select is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/apps/web/src/components/ui.jsx <module evaluation>", "Select");
}),
"[project]/apps/web/src/components/ui.jsx [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$components$2f$ui$2e$jsx__$5b$app$2d$rsc$5d$__$28$client__reference__proxy$29$__$3c$module__evaluation$3e$__ = __turbopack_context__.i("[project]/apps/web/src/components/ui.jsx [app-rsc] (client reference proxy) <module evaluation>");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$components$2f$ui$2e$jsx__$5b$app$2d$rsc$5d$__$28$client__reference__proxy$29$__ = __turbopack_context__.i("[project]/apps/web/src/components/ui.jsx [app-rsc] (client reference proxy)");
;
__turbopack_context__.n(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$components$2f$ui$2e$jsx__$5b$app$2d$rsc$5d$__$28$client__reference__proxy$29$__);
}),
"[project]/apps/web/src/lib/api-client.js [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "DEFAULT_API_URL",
    ()=>DEFAULT_API_URL,
    "getApiBaseUrl",
    ()=>getApiBaseUrl,
    "getApiClient",
    ()=>getApiClient,
    "resetApiClient",
    ()=>resetApiClient
]);
/**
 * The API client itself, with no server-only baggage attached.
 *
 * This exists as a separate module from `api.js` for one reason: `api.js`
 * imports the curated fallback catalogue, which is thirty kilobytes of event
 * data that exists so server-rendered pages still work when the API is down.
 * The browser never needs it — a client component that reached for the API
 * client dragged the whole catalogue into the browser bundle with it.
 *
 * Anything imported from a `'use client'` component belongs here. Anything that
 * falls back to sample data belongs in `api.js`, which is only ever imported on
 * the server.
 *
 * @module lib/api-client
 */ var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$api$2d$contract$2f$src$2f$index$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/packages/api-contract/src/index.js [app-rsc] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$api$2d$contract$2f$src$2f$client$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/packages/api-contract/src/client.js [app-rsc] (ecmascript) <locals>");
;
const DEFAULT_API_URL = 'http://127.0.0.1:4000';
/** @type {object|null} */ let cachedClient = null;
/** @type {string|null} */ let cachedBaseUrl = null;
function getApiBaseUrl() {
    const configured = process.env.NEXT_PUBLIC_API_URL;
    return typeof configured === 'string' && configured.trim() !== '' ? configured.trim() : DEFAULT_API_URL;
}
function getApiClient() {
    const baseUrl = getApiBaseUrl();
    if (!cachedClient || cachedBaseUrl !== baseUrl) {
        cachedClient = (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$api$2d$contract$2f$src$2f$client$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$locals$3e$__["createApiClient"])({
            baseUrl
        });
        cachedBaseUrl = baseUrl;
    }
    return cachedClient;
}
function resetApiClient() {
    cachedClient = null;
    cachedBaseUrl = null;
}
}),
"[project]/apps/web/src/lib/api.js [app-rsc] (ecmascript) <locals>", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "loadCatalogueFacets",
    ()=>loadCatalogueFacets,
    "loadCatalogueOverview",
    ()=>loadCatalogueOverview,
    "loadEventBySlug",
    ()=>loadEventBySlug,
    "loadEventList",
    ()=>loadEventList,
    "loadOrganizerBySlug",
    ()=>loadOrganizerBySlug,
    "resetApiClient",
    ()=>resetApiClient,
    "withTicketTypeAvailability",
    ()=>withTicketTypeAvailability
]);
/**
 * The web app's data layer.
 *
 * Two things shape every function in this file.
 *
 * The first is that the API is a **separate process that is frequently not
 * running**: during `next build`, in unit tests, on a fresh clone, and any time
 * a deploy of the API lags a deploy of the web app. A ticketing site that
 * answers those moments with a stack trace or an empty grid is worse than one
 * that shows a catalogue, so every read here fails soft: it catches, warns once
 * on the server, and falls back to the curated catalogue in `sample-data.js`.
 * A visitor never sees an error, and the server log always says exactly what
 * went wrong.
 *
 * The second is that the API never gets to decide the shape of the page.
 * Anything that comes back malformed — a missing `data` array, a null body —
 * is treated as a failure and takes the same fallback path, because a
 * half-rendered page is a bug report either way.
 *
 * Fallback never applies to writes. There is no pretending an order was placed.
 *
 * @module lib/api
 */ var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$catalog$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/src/lib/catalog.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$search$2d$params$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/src/lib/search-params.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$api$2d$client$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/src/lib/api-client.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$sample$2d$data$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/src/lib/sample-data.js [app-rsc] (ecmascript)");
;
;
;
;
;
function resetApiClient() {
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$api$2d$client$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["resetApiClient"])();
    warnedKeys.clear();
}
/**
 * How long a single API read may take before the page gives up and renders the
 * fallback. Kept short: a visitor waiting ten seconds for a listing has already
 * left, and a build that blocks on an unreachable host never finishes.
 */ const REQUEST_TIMEOUT_MS = 2500;
/** Warning keys already logged, so one dead API does not produce one line per card. */ const warnedKeys = new Set();
/**
 * Log an API failure once per key, on the server only.
 *
 * Repeating the same "connection refused" for every card on the page buries the
 * one line that matters, and the message never reaches the browser console of a
 * visitor who can do nothing about it.
 *
 * @param {string} key Stable key identifying the failing read.
 * @param {unknown} error The caught error.
 * @returns {void}
 */ function warnOnce(key, error) {
    if (warnedKeys.has(key)) return;
    warnedKeys.add(key);
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`[desi-event/web] ${key} fell back to the sample catalogue: ${reason} ` + `(API at ${(0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$api$2d$client$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["getApiBaseUrl"])()})`);
}
/**
 * Per-call options for an API read.
 *
 * @returns {{signal: AbortSignal}} A call option bag carrying a timeout signal.
 */ function callOptions() {
    return {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    };
}
/**
 * Run an API read, falling back to locally curated data on any failure.
 *
 * @param {string} key Stable key used for the warning and for de-duplicating it.
 * @param {Function} read Async function performing the API call; must return the finished result.
 * @param {Function} fallback Synchronous function producing the offline result.
 * @returns {Promise<object>} The API result, or the fallback result.
 */ async function readOrFallback(key, read, fallback) {
    try {
        const result = await read();
        if (result === undefined || result === null) {
            throw new Error('the API returned an empty payload');
        }
        return result;
    } catch (error) {
        warnOnce(key, error);
        return fallback();
    }
}
async function loadEventList(filters = {}, options = {}) {
    const { category, city, q, page = 1, perPage = 12 } = filters;
    return readOrFallback('events.list', async ()=>{
        const client = options.client ?? (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$api$2d$client$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["getApiClient"])();
        const response = await client.events.list({
            page,
            perPage,
            sort: 'startsAt:asc',
            status: 'PUBLISHED',
            ...category ? {
                category
            } : {},
            ...city ? {
                city
            } : {},
            ...q ? {
                q
            } : {}
        }, callOptions());
        if (!Array.isArray(response?.data)) {
            throw new Error('events.list returned no data array');
        }
        return {
            events: response.data,
            pagination: response.pagination,
            usedFallback: false
        };
    }, ()=>{
        const matching = (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$catalog$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["sortByStartDate"])((0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$catalog$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["filterEvents"])((0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$sample$2d$data$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["sampleEventSummaries"])(), {
            category,
            city,
            q
        }));
        const { items, pagination } = (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$search$2d$params$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["paginate"])(matching, {
            page,
            perPage
        });
        return {
            events: items,
            pagination,
            usedFallback: true
        };
    });
}
async function loadEventBySlug(slug, options = {}) {
    return readOrFallback('events.get', async ()=>{
        const client = options.client ?? (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$api$2d$client$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["getApiClient"])();
        const response = await client.events.get({
            slug
        }, callOptions());
        if (!response?.data?.slug) {
            throw new Error('events.get returned no event');
        }
        return {
            event: withTicketTypeAvailability(response.data),
            usedFallback: false
        };
    }, ()=>({
            event: (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$sample$2d$data$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["findSampleEvent"])(slug),
            usedFallback: true
        }));
}
async function loadOrganizerBySlug(slug, options = {}) {
    return readOrFallback('organizers.get', async ()=>{
        const client = options.client ?? (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$api$2d$client$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["getApiClient"])();
        const response = await client.organizers.get({
            slug
        }, callOptions());
        if (!response?.data?.slug) {
            throw new Error('organizers.get returned no organiser');
        }
        return {
            organizer: response.data,
            usedFallback: false
        };
    }, ()=>({
            organizer: (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$sample$2d$data$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["findSampleOrganizer"])(slug),
            usedFallback: true
        }));
}
async function loadCatalogueOverview(options = {}) {
    return loadEventList({
        page: 1,
        perPage: 48
    }, options);
}
/** Facet lists used when the API cannot be reached. */ const FALLBACK_FACETS = Object.freeze({
    scope: {
        status: 'PUBLISHED',
        total: 0
    },
    categories: [],
    cities: [],
    languages: [],
    formats: []
});
async function loadCatalogueFacets(options = {}) {
    /**
   * Tally a list of values into facet entries.
   *
   * @param {string[]} values Raw values.
   * @returns {Array<{value: string, count: number}>} Counted, deterministically ordered.
   */ const count = (values)=>{
        const tally = new Map();
        for (const value of values)tally.set(value, (tally.get(value) ?? 0) + 1);
        return [
            ...tally.entries()
        ].map(([value, n])=>({
                value,
                count: n
            })).sort((a, b)=>b.count - a.count || a.value.localeCompare(b.value));
    };
    return readOrFallback('facets', async ()=>{
        const client = options.client ?? (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$api$2d$client$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["getApiClient"])();
        const response = await client.events.facets();
        return {
            facets: response.data,
            usedFallback: false
        };
    }, ()=>{
        // Derive what we can from the sample catalogue so the selects are not
        // empty when the API is down.
        const events = (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$sample$2d$data$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["sampleEventSummaries"])();
        return {
            facets: {
                ...FALLBACK_FACETS,
                scope: {
                    status: 'PUBLISHED',
                    total: events.length
                },
                categories: count(events.map((event)=>event.category)),
                cities: count(events.map((event)=>event.city).filter(Boolean))
            },
            usedFallback: true
        };
    });
}
function withTicketTypeAvailability(event) {
    const ticketTypes = (event?.ticketTypes ?? []).map((tier)=>{
        const remaining = Math.max(0, (tier.quantityTotal ?? 0) - (tier.quantitySold ?? 0));
        const availableQuantity = tier.availableQuantity ?? remaining;
        const isSoldOut = tier.isSoldOut ?? (tier.status !== 'ON_SALE' || availableQuantity === 0);
        return {
            ...tier,
            availableQuantity: isSoldOut ? 0 : availableQuantity,
            isSoldOut
        };
    });
    return {
        ...event,
        ticketTypes
    };
}
}),
"[project]/apps/web/src/lib/format.js [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "formatEventDate",
    ()=>formatEventDate,
    "formatEventLocation",
    ()=>formatEventLocation,
    "formatEventTime",
    ()=>formatEventTime,
    "formatEventWhen",
    ()=>formatEventWhen,
    "formatTimeZoneLabel",
    ()=>formatTimeZoneLabel,
    "formatVenueAddress",
    ()=>formatVenueAddress,
    "toDateTimeAttribute",
    ()=>toDateTimeAttribute,
    "toParagraphs",
    ()=>toParagraphs
]);
/**
 * Date, time and place formatting.
 *
 * Every event carries its own IANA timezone, and that is the timezone the
 * event happens in — a Diwali mela in Mississauga starts at 2 pm in Toronto
 * regardless of where the person reading the page is sitting. So every helper
 * here formats in the *event's* zone and says which zone that was, rather than
 * silently converting to the viewer's local time.
 *
 * Formatting in an explicit timezone also makes the output identical on the
 * server and in the browser, which is what keeps React from reporting a
 * hydration mismatch on every date on the page.
 *
 * @module lib/format
 */ /** Locale used when a caller does not supply one. */ const DEFAULT_LOCALE = 'en-IN';
function formatEventDate(value, timeZone = 'Asia/Kolkata', locale = DEFAULT_LOCALE) {
    const date = toDate(value);
    if (!date) return '';
    return new Intl.DateTimeFormat(locale, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone
    }).format(date);
}
function formatEventTime(value, timeZone = 'Asia/Kolkata', locale = DEFAULT_LOCALE) {
    const date = toDate(value);
    if (!date) return '';
    return new Intl.DateTimeFormat(locale, {
        hour: 'numeric',
        minute: '2-digit',
        timeZone
    }).format(date);
}
function formatEventWhen(event, locale = DEFAULT_LOCALE) {
    const zone = event?.timezone ?? 'Asia/Kolkata';
    const start = toDate(event?.startsAt);
    if (!start) return '';
    const end = toDate(event?.endsAt);
    const startDate = formatEventDate(start, zone, locale);
    const startTime = formatEventTime(start, zone, locale);
    if (!end) return `${startDate} · ${startTime}`;
    const endDate = formatEventDate(end, zone, locale);
    const endTime = formatEventTime(end, zone, locale);
    if (startDate === endDate) return `${startDate} · ${startTime} – ${endTime}`;
    return `${startDate}, ${startTime} – ${endDate}, ${endTime}`;
}
function formatTimeZoneLabel(event, locale = DEFAULT_LOCALE) {
    const date = toDate(event?.startsAt);
    if (!date) return '';
    const parts = new Intl.DateTimeFormat(locale, {
        timeZone: event?.timezone ?? 'Asia/Kolkata',
        timeZoneName: 'short'
    }).formatToParts(date);
    return parts.find((part)=>part.type === 'timeZoneName')?.value ?? '';
}
function toDateTimeAttribute(value) {
    return toDate(value)?.toISOString();
}
function formatEventLocation(event) {
    if (event?.isOnline) return 'Online';
    const venueName = event?.venue?.name ?? event?.venueName;
    const city = event?.venue?.city ?? event?.city;
    return [
        venueName,
        city
    ].filter(Boolean).join(', ') || 'Venue to be announced';
}
function formatVenueAddress(venue) {
    if (!venue) return [];
    return [
        venue.addressLine1,
        venue.addressLine2,
        [
            venue.city,
            venue.region
        ].filter(Boolean).join(', '),
        venue.postalCode
    ].filter(Boolean);
}
function toParagraphs(description) {
    if (typeof description !== 'string') return [];
    return description.split(/\n{2,}/).map((paragraph)=>paragraph.trim()).filter((paragraph)=>paragraph !== '');
}
/**
 * Coerce a timestamp to a valid `Date`.
 *
 * @param {string|number|Date|null|undefined} value Candidate timestamp.
 * @returns {Date|null} A valid `Date`, or `null` when the value cannot be read as one.
 */ function toDate(value) {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}
}),
"[project]/apps/web/src/lib/pricing.js [app-rsc] (ecmascript) <locals>", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "formatAmount",
    ()=>formatAmount,
    "formatPrice",
    ()=>formatPrice,
    "localeForCurrency",
    ()=>localeForCurrency,
    "priceSelection",
    ()=>priceSelection,
    "taxLabelForPlace",
    ()=>taxLabelForPlace
]);
/**
 * The web app's view of money.
 *
 * Arithmetic itself belongs to `@desi-event/pricing`; this module only supplies
 * the inputs that depend on where an event is being sold. The totals a visitor
 * sees during checkout are an *estimate*: the server recomputes every column
 * from the ticket type rows when the order is placed, and that result is the
 * one that is charged. Showing the estimate anyway is worth it — a checkout
 * that hides the fee until the last step is the thing everyone hates about
 * buying tickets.
 *
 * @module lib/pricing
 */ var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$index$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/packages/pricing/src/index.js [app-rsc] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$totals$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/pricing/src/totals.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$currencies$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/pricing/src/currencies.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$money$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/pricing/src/money.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$tax$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/pricing/src/tax.js [app-rsc] (ecmascript)");
;
;
function taxLabelForPlace(place = {}) {
    const policy = (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$tax$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["resolveTaxPolicy"])({
        country: place.country,
        region: place.region
    });
    if (!policy.resolved || policy.rateBps === 0) return 'Tax';
    return `${policy.name} (${policy.rateBps / 100}%)`;
}
function localeForCurrency(currency = 'INR') {
    const code = String(currency || 'INR').toUpperCase();
    return ({
        INR: 'en-IN',
        CAD: 'en-CA',
        GBP: 'en-GB',
        USD: 'en-US',
        AUD: 'en-AU'
    })[code] ?? 'en-IN';
}
function formatPrice(cents, currency = 'INR') {
    if (cents === 0) return 'Free';
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$money$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["formatMoney"])(cents, currency, localeForCurrency(currency));
}
function formatAmount(cents, currency = 'INR') {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$money$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["formatMoney"])(cents, currency, localeForCurrency(currency));
}
function priceSelection({ lines, currency, place = {} }) {
    const items = (lines ?? []).filter((line)=>line.quantity > 0).map((line)=>({
            ticketTypeId: line.ticketTypeId,
            name: line.name,
            quantity: line.quantity,
            unitPriceCents: line.unitPriceCents
        }));
    // Tax follows where the event is held, not the currency it is priced in —
    // the same resolution the server performs, from the same table, so the quote
    // the buyer sees and the total they are charged cannot disagree.
    const taxPolicy = (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$tax$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["resolveTaxPolicy"])({
        country: place.country,
        region: place.region
    });
    const totals = (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$totals$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["computeOrderTotals"])({
        items,
        feeConfig: (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$currencies$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["feeConfigForCurrency"])(currency),
        taxRateBps: taxPolicy.rateBps,
        currency
    });
    return {
        ...totals,
        taxPolicy
    };
}
}),
"[project]/apps/web/src/lib/sample-data.js [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "SAMPLE_EVENTS",
    ()=>SAMPLE_EVENTS,
    "findSampleEvent",
    ()=>findSampleEvent,
    "findSampleOrganizer",
    ()=>findSampleOrganizer,
    "sampleCities",
    ()=>sampleCities,
    "sampleEventSummaries",
    ()=>sampleEventSummaries,
    "toEventSummary",
    ()=>toEventSummary
]);
/**
 * The curated catalogue the site falls back to when the API cannot be reached.
 *
 * This is not filler. The API is a separate process that is routinely down
 * during `next build`, during unit tests and on a fresh clone, and a ticketing
 * site that renders an empty grid in those moments looks broken rather than
 * offline. So the web app ships a small, real-looking catalogue — ten events
 * across Mumbai, Ahmedabad, Toronto and London, priced in the minor units of
 * their own currency — and renders that instead of an error.
 *
 * Shapes here match `eventWithRelationsSchema` and `ticketTypeListResponseSchema`
 * from `@desi-event/schemas` so that a component cannot tell the difference
 * between a sample event and a live one.
 *
 * Dates are generated relative to process start rather than hard-coded, so the
 * fallback catalogue never rots into a listing of events that happened last
 * year. They are computed once at module load, which keeps a single server
 * render internally consistent.
 *
 * @module lib/sample-data
 */ /** Instant the relative dates below are measured from, fixed for the process. */ const BASE_TIME = Date.now();
/** Milliseconds in a day. */ const DAY_MS = 86_400_000;
/**
 * Build an ISO-8601 timestamp a whole number of days from process start.
 *
 * @param {number} days Offset in days; may be negative for a past event.
 * @param {number} [utcHour] Hour of day in UTC.
 * @param {number} [utcMinute] Minute of the hour in UTC.
 * @returns {string} A UTC ISO-8601 timestamp.
 */ function daysFromNow(days, utcHour = 12, utcMinute = 0) {
    const date = new Date(BASE_TIME + days * DAY_MS);
    date.setUTCHours(utcHour, utcMinute, 0, 0);
    return date.toISOString();
}
/** Organisations that appear in the fallback catalogue. */ const ORGANIZATIONS = {
    rangmanch: {
        id: 'orgrangmanchmumbai',
        name: 'Rangmanch Collective',
        slug: 'rangmanch-collective',
        description: 'Independent promoters putting South Asian artists on Bombay stages since 2011.',
        contactEmail: 'hello@rangmanch.example',
        websiteUrl: 'https://rangmanch.example',
        verified: true,
        payoutCurrency: 'INR',
        verificationStatus: 'VERIFIED',
        timezone: 'Asia/Kolkata',
        refundPolicy: 'Full refund up to seven days before the performance; no refunds after that, but tickets may be transferred.'
    },
    navrang: {
        id: 'orgnavrangutsav',
        name: 'Navrang Utsav Samiti',
        slug: 'navrang-utsav-samiti',
        description: 'The Ahmedabad garba committee behind nine nights of raas since 1987.',
        contactEmail: 'samiti@navrangutsav.example',
        websiteUrl: 'https://navrangutsav.example',
        verified: true,
        payoutCurrency: 'INR',
        verificationStatus: 'VERIFIED',
        timezone: 'Asia/Kolkata',
        refundPolicy: 'Passes are non-refundable once the first night has begun. Before that, a full refund less the payment fee.'
    },
    desiBeats: {
        id: 'orgdesibeatsto',
        name: 'Desi Beats Toronto',
        slug: 'desi-beats-toronto',
        description: 'GTA nightlife for the diaspora — bhangra, Bollywood and everything in between.',
        contactEmail: 'crew@desibeats.example',
        websiteUrl: 'https://desibeats.example',
        verified: true,
        payoutCurrency: 'CAD',
        verificationStatus: 'VERIFIED',
        timezone: 'America/Toronto',
        refundPolicy: 'Refunds up to 72 hours before doors. After that the ticket is yours to transfer.'
    },
    masala: {
        id: 'orgmasalaartsldn',
        name: 'Masala Arts London',
        slug: 'masala-arts-london',
        description: 'A Whitechapel arts charity programming South Asian theatre, comedy and film.',
        contactEmail: 'box.office@masalaarts.example',
        websiteUrl: 'https://masalaarts.example',
        verified: false,
        payoutCurrency: 'GBP',
        verificationStatus: 'UNVERIFIED',
        timezone: 'Europe/London',
        refundPolicy: 'Refunds up to 24 hours before curtain, or an exchange into any other show in the season.'
    },
    swarSadhana: {
        id: 'orgswarsadhana',
        name: 'Swar Sadhana Trust',
        slug: 'swar-sadhana-trust',
        description: 'Custodians of Hindustani and Carnatic repertoire, and of the artists who carry it.',
        contactEmail: 'trust@swarsadhana.example',
        websiteUrl: 'https://swarsadhana.example',
        verified: true,
        payoutCurrency: 'INR',
        verificationStatus: 'VERIFIED',
        timezone: 'Asia/Kolkata',
        refundPolicy: 'A full refund at any point up to the interval of the first half, in keeping with a long-standing practice of the trust.'
    }
};
/** Venues that appear in the fallback catalogue. */ const VENUES = {
    jioGarden: {
        id: 'vnujioworldmumbai',
        name: 'Jio World Garden',
        addressLine1: 'Bandra Kurla Complex',
        addressLine2: 'G Block, BKC',
        city: 'Mumbai',
        region: 'Maharashtra',
        postalCode: '400051',
        country: 'IN',
        latitude: 19.0653,
        longitude: 72.8676,
        capacity: 6000
    },
    nehruCentre: {
        id: 'vnunehrucentremum',
        name: 'Nehru Centre Auditorium',
        addressLine1: 'Dr Annie Besant Road',
        addressLine2: 'Worli',
        city: 'Mumbai',
        region: 'Maharashtra',
        postalCode: '400018',
        country: 'IN',
        latitude: 18.9949,
        longitude: 72.8203,
        capacity: 1100
    },
    gmdcGround: {
        id: 'vnugmdcahmedabad',
        name: 'GMDC Ground',
        addressLine1: 'University Road',
        addressLine2: 'Gujarat University Campus',
        city: 'Ahmedabad',
        region: 'Gujarat',
        postalCode: '380009',
        country: 'IN',
        latitude: 23.0367,
        longitude: 72.5455,
        capacity: 20000
    },
    tagoreHall: {
        id: 'vnutagoreahmedabad',
        name: 'Tagore Hall',
        addressLine1: 'Sanskar Kendra Road',
        addressLine2: 'Paldi',
        city: 'Ahmedabad',
        region: 'Gujarat',
        postalCode: '380007',
        country: 'IN',
        latitude: 23.0159,
        longitude: 72.5652,
        capacity: 700
    },
    meridianHall: {
        id: 'vnumeridiantoronto',
        name: 'Meridian Hall',
        addressLine1: '1 Front Street East',
        addressLine2: null,
        city: 'Toronto',
        region: 'Ontario',
        postalCode: 'M5E 1B2',
        country: 'CA',
        latitude: 43.6462,
        longitude: -79.3755,
        capacity: 3191
    },
    celebrationSquare: {
        id: 'vnucelebrationsqto',
        name: 'Mississauga Celebration Square',
        addressLine1: '300 City Centre Drive',
        addressLine2: null,
        city: 'Toronto',
        region: 'Ontario',
        postalCode: 'L5B 3C1',
        country: 'CA',
        latitude: 43.5931,
        longitude: -79.6444,
        capacity: 12000
    },
    troxy: {
        id: 'vnutroxylondon',
        name: 'Troxy',
        addressLine1: '490 Commercial Road',
        addressLine2: 'Limehouse',
        city: 'London',
        region: 'Greater London',
        postalCode: 'E1 0HX',
        country: 'GB',
        latitude: 51.5133,
        longitude: -0.0377,
        capacity: 3100
    },
    southbank: {
        id: 'vnusouthbanklondon',
        name: 'Southbank Centre, Queen Elizabeth Hall',
        addressLine1: 'Belvedere Road',
        addressLine2: 'South Bank',
        city: 'London',
        region: 'Greater London',
        postalCode: 'SE1 8XX',
        country: 'GB',
        latitude: 51.5062,
        longitude: -0.1161,
        capacity: 900
    }
};
/**
 * Expand a compact ticket tier definition into a full ticket type record.
 *
 * @param {string} eventId Owning event id.
 * @param {string} currency ISO 4217 code every tier of the event is priced in.
 * @param {object} tier Compact tier definition.
 * @param {number} index Position of the tier, used for `sortOrder`.
 * @returns {object} A ticket type with live availability folded in, as the API returns it.
 */ function toTicketType(eventId, currency, tier, index) {
    const quantitySold = tier.quantitySold ?? 0;
    const availableQuantity = Math.max(0, tier.quantityTotal - quantitySold);
    const soldOutStatus = availableQuantity === 0 ? 'SOLD_OUT' : tier.status ?? 'ON_SALE';
    return {
        id: tier.id,
        eventId,
        name: tier.name,
        description: tier.description ?? null,
        priceCents: tier.priceCents,
        currency,
        quantityTotal: tier.quantityTotal,
        quantitySold,
        minPerOrder: tier.minPerOrder ?? 1,
        maxPerOrder: tier.maxPerOrder ?? 8,
        salesStartAt: null,
        salesEndAt: null,
        status: soldOutStatus,
        sortOrder: index,
        availableQuantity: soldOutStatus === 'ON_SALE' ? availableQuantity : 0,
        isSoldOut: soldOutStatus !== 'ON_SALE'
    };
}
/**
 * Whether a verification state earns the public badge.
 *
 * One state, mirroring `BADGED_STATES` on the server. Duplicated rather than
 * imported because this module is the *offline* catalogue and must not depend
 * on the API package it stands in for — but kept to one place here, so the
 * fallback cannot show a badge the live site would not.
 *
 * @param {object} organization A sample organisation.
 * @returns {boolean} True when the badge is earned.
 */ function isBadged(organization) {
    return organization.verificationStatus === 'VERIFIED';
}
/**
 * A sample organisation reduced to the shape the API publishes.
 *
 * Matches `publicOrganizerSummarySchema`: no contact address, no payout
 * currency. The point of the fallback is that a component cannot tell the
 * difference between it and a live payload, and finding NF-14 narrowed what
 * the live payload contains.
 *
 * @param {object} organization A sample organisation.
 * @returns {object} The public summary.
 */ function toPublicOrganizer(organization) {
    return {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        description: organization.description,
        websiteUrl: organization.websiteUrl,
        verified: isBadged(organization)
    };
}
/**
 * Expand a compact event definition into the full relation-bearing shape the
 * detail page consumes.
 *
 * @param {object} definition Compact event definition.
 * @returns {object} An event matching `eventWithRelationsSchema`.
 */ function toEvent(definition) {
    const { organization, venue, currency, tiers, ...event } = definition;
    return {
        ...event,
        organizationId: organization.id,
        venueId: venue.id,
        status: 'PUBLISHED',
        coverImageUrl: null,
        isOnline: false,
        onlineUrl: null,
        publishedAt: daysFromNow(-42, 9, 0),
        organization: toPublicOrganizer(organization),
        venue,
        ticketTypes: tiers.map((tier, index)=>toTicketType(event.id, currency, tier, index))
    };
}
/** Compact definitions, expanded below. Ordered by start date. */ const EVENT_DEFINITIONS = [
    {
        id: 'evtnavratrirasgarba',
        title: 'Navratri Raas Garba — Nine Nights',
        slug: 'navratri-raas-garba-nine-nights',
        summary: 'Nine nights of traditional raas and dandiya on the GMDC ground, with a live dhol ensemble and a sixty-piece orchestra.',
        description: [
            'Ahmedabad does not do Navratri by halves. From the first beat of the dhol at sundown to the last taali well past two in the morning, the GMDC ground turns into a single circle of colour that keeps widening as the night goes on.',
            'The Navrang Utsav Samiti has run these nights since 1987. The orchestra is live — no backing tracks, no DJ sets — and the repertoire moves from slow sanedo through do taali, teen taali and into the fast dodhiya that separates the serious players from the rest of us.',
            'Come in chaniya choli or kediyu if you have it, comfortable shoes if you do not. Water and chaas are free at the eastern gate. Garba lessons run each evening from 7 pm for anyone joining their first night.'
        ].join('\n\n'),
        category: 'GARBA_DANDIYA',
        startsAt: daysFromNow(27, 13, 30),
        endsAt: daysFromNow(27, 20, 30),
        timezone: 'Asia/Kolkata',
        languages: [
            'Gujarati',
            'Hindi'
        ],
        organization: ORGANIZATIONS.navrang,
        venue: VENUES.gmdcGround,
        currency: 'INR',
        tiers: [
            {
                id: 'ttngarbaseasonpass',
                name: 'Season Pass — All Nine Nights',
                description: 'One wristband, every night, plus priority entry at the west gate.',
                priceCents: 899_900,
                quantityTotal: 1200,
                quantitySold: 1147,
                minPerOrder: 1,
                maxPerOrder: 4
            },
            {
                id: 'ttngarbacouplenite',
                name: 'Couple Entry — Single Night',
                description: 'Admits two. Choose your night at the gate.',
                priceCents: 249_900,
                quantityTotal: 4000,
                quantitySold: 2610,
                minPerOrder: 1,
                maxPerOrder: 5
            },
            {
                id: 'ttngarbasinglenite',
                name: 'Single Night Entry',
                description: 'General admission to the main circle.',
                priceCents: 149_900,
                quantityTotal: 9000,
                quantitySold: 5120,
                minPerOrder: 1,
                maxPerOrder: 10
            }
        ]
    },
    {
        id: 'evtqawwalibanyan',
        title: 'Qawwali Under the Banyan',
        slug: 'qawwali-under-the-banyan',
        summary: 'An open-air evening of Sufi qawwali in Bandra Kurla Complex, with the Nizami brothers closing on Chhaap Tilak.',
        description: [
            'A qawwali does not really start until the audience decides it has. This one begins at dusk in the Jio World Garden, on a low stage under the old banyan, with the harmonium finding its drone while the city traffic is still audible over the wall.',
            'Three ensembles share the night. The Warsi brothers open with Amir Khusrau in Braj and Persian; the Rizwan-Muazzam party take the middle set; and the Nizamis close, as they always do, with Chhaap Tilak — at which point nobody is sitting down.',
            'Floor cushions and low seating throughout. The chai stall by the north gate stays open until the last note.'
        ].join('\n\n'),
        category: 'MUSIC_CONCERT',
        startsAt: daysFromNow(12, 13, 0),
        endsAt: daysFromNow(12, 17, 30),
        timezone: 'Asia/Kolkata',
        languages: [
            'Urdu',
            'Hindi',
            'Punjabi'
        ],
        organization: ORGANIZATIONS.rangmanch,
        venue: VENUES.jioGarden,
        currency: 'INR',
        tiers: [
            {
                id: 'ttqawwalimehfil',
                name: 'Mehfil Floor — Front Cushions',
                description: 'Cushioned floor seating within ten feet of the ensemble.',
                priceCents: 449_900,
                quantityTotal: 180,
                quantitySold: 180,
                minPerOrder: 1,
                maxPerOrder: 4
            },
            {
                id: 'ttqawwaligarden',
                name: 'Garden Seating',
                description: 'Reserved chairs on the lawn, with table service for chai.',
                priceCents: 249_900,
                quantityTotal: 900,
                quantitySold: 612,
                minPerOrder: 1,
                maxPerOrder: 6
            },
            {
                id: 'ttqawwalilawn',
                name: 'Lawn Entry',
                description: 'Unreserved standing and picnic-rug space at the back of the garden.',
                priceCents: 99_900,
                quantityTotal: 2400,
                quantitySold: 1380,
                minPerOrder: 1,
                maxPerOrder: 10
            }
        ]
    },
    {
        id: 'evtbollywoodretroto',
        title: 'Bollywood Nights: Retro Rewind',
        slug: 'bollywood-nights-retro-rewind',
        summary: 'Four decades of filmi floor-fillers at Meridian Hall — RD Burman to Pritam, mixed live across two rooms.',
        description: [
            'Downtown Toronto, one room of disco-era RD Burman and Bappi Lahiri, one room of everything after Dil Chahta Hai, and a corridor between them that becomes its own dance floor by midnight.',
            'DJ Rekha Sandhu opens the retro room at nine. The bhangra room runs a live dhol player alongside the decks from eleven. Expect Jimmy Jimmy, expect Choli Ke Peeche, and expect the entire room to know every word of Kajra Re.',
            'Nineteen-plus with valid photo ID. Coat check is included in the ticket — it is November, and you will want it.'
        ].join('\n\n'),
        category: 'BOLLYWOOD_NIGHT',
        startsAt: daysFromNow(19, 1, 0),
        endsAt: daysFromNow(19, 7, 0),
        timezone: 'America/Toronto',
        languages: [
            'English',
            'Hindi',
            'Punjabi'
        ],
        organization: ORGANIZATIONS.desiBeats,
        venue: VENUES.meridianHall,
        currency: 'CAD',
        tiers: [
            {
                id: 'ttbollyvipbooth',
                name: 'VIP Booth (seats 6)',
                description: 'Raised booth overlooking the retro floor, bottle service included.',
                priceCents: 60_000,
                quantityTotal: 24,
                quantitySold: 21,
                minPerOrder: 1,
                maxPerOrder: 2
            },
            {
                id: 'ttbollyearlybird',
                name: 'Early Bird',
                description: 'Entry before 10 pm, coat check included.',
                priceCents: 3500,
                quantityTotal: 600,
                quantitySold: 600,
                minPerOrder: 1,
                maxPerOrder: 8
            },
            {
                id: 'ttbollygeneraladm',
                name: 'General Admission',
                description: 'Entry any time, both rooms, coat check included.',
                priceCents: 5500,
                quantityTotal: 1800,
                quantitySold: 940,
                minPerOrder: 1,
                maxPerOrder: 8
            }
        ]
    },
    {
        id: 'evtchaatchaifest',
        title: 'Chaat & Chai Street Food Festival',
        slug: 'chaat-and-chai-street-food-festival',
        summary: 'Forty stalls along the Southbank serving everything from Amritsari kulcha to Sri Lankan kottu, plus a cutting-chai bar.',
        description: [
            'A weekend of South Asian street food on the Thames, from the Queen Elizabeth Hall terrace down to the skate park. Forty stalls, eleven regions, one very long queue for the Amritsari kulcha which is, we are told, worth it.',
            'The cutting-chai bar pours masala, Irani, Kashmiri noon chai and a Sri Lankan plain tea, and the stall holders will happily argue with you about which is best. Live dhol at noon and at four. The Bengali sweet stall sells out of nolen gur sandesh by two, every single day.',
            'Entry covers both days. Most stalls are cash-free. Vegetarian, vegan, halal and Jain options are labelled at every counter.'
        ].join('\n\n'),
        category: 'FOOD_FESTIVAL',
        startsAt: daysFromNow(34, 10, 0),
        endsAt: daysFromNow(35, 19, 0),
        timezone: 'Europe/London',
        languages: [
            'English',
            'Bengali',
            'Tamil'
        ],
        organization: ORGANIZATIONS.masala,
        venue: VENUES.southbank,
        currency: 'GBP',
        tiers: [
            {
                id: 'ttchaatfeastpass',
                name: 'Feast Pass',
                description: 'Weekend entry plus eight tasting tokens and a festival thali plate.',
                priceCents: 4500,
                quantityTotal: 900,
                quantitySold: 407,
                minPerOrder: 1,
                maxPerOrder: 6
            },
            {
                id: 'ttchaatweekendadm',
                name: 'Weekend Entry',
                description: 'Both days, pay as you go at the stalls.',
                priceCents: 1200,
                quantityTotal: 6000,
                quantitySold: 2211,
                minPerOrder: 1,
                maxPerOrder: 10
            },
            {
                id: 'ttchaatunderfive',
                name: 'Under 12s',
                description: 'Free entry, still needs a ticket so we can count the queue.',
                priceCents: 0,
                quantityTotal: 2000,
                quantitySold: 640,
                minPerOrder: 1,
                maxPerOrder: 6
            }
        ]
    },
    {
        id: 'evtmargambharatnat',
        title: 'Margam — An Evening of Bharatanatyam',
        slug: 'margam-an-evening-of-bharatanatyam',
        summary: 'A full traditional margam performed by Meenakshi Sundaram at the Nehru Centre, with live mridangam and nattuvangam.',
        description: [
            'The margam is the complete arc of a Bharatanatyam recital: alarippu to open, then jatiswaram, shabdam, the long varnam at its centre, padams and javalis, and a tillana to close. Performed whole, it runs close to two hours and asks as much of the audience as of the dancer.',
            'Meenakshi Sundaram trained at Kalakshetra and has not performed in Bombay for four years. She is accompanied by live mridangam, violin, flute and nattuvangam — no recorded track at any point in the evening.',
            'A twenty-minute introduction to the form runs at 5.40 pm in the foyer for anyone new to it. Latecomers are seated only between items.'
        ].join('\n\n'),
        category: 'CLASSICAL_DANCE',
        startsAt: daysFromNow(9, 12, 30),
        endsAt: daysFromNow(9, 15, 0),
        timezone: 'Asia/Kolkata',
        languages: [
            'Tamil',
            'English'
        ],
        organization: ORGANIZATIONS.swarSadhana,
        venue: VENUES.nehruCentre,
        currency: 'INR',
        tiers: [
            {
                id: 'ttmargampatron',
                name: 'Patron Circle',
                description: 'First six rows, programme notes and a post-show reception with the artist.',
                priceCents: 350_000,
                quantityTotal: 120,
                quantitySold: 89,
                minPerOrder: 1,
                maxPerOrder: 4
            },
            {
                id: 'ttmargamstalls',
                name: 'Stalls',
                description: 'Reserved seating in the main auditorium.',
                priceCents: 150_000,
                quantityTotal: 620,
                quantitySold: 318,
                minPerOrder: 1,
                maxPerOrder: 6
            },
            {
                id: 'ttmargamstudent',
                name: 'Student & Senior',
                description: 'Balcony seating. Bring ID to the door.',
                priceCents: 40_000,
                quantityTotal: 260,
                quantitySold: 204,
                minPerOrder: 1,
                maxPerOrder: 2
            }
        ]
    },
    {
        id: 'evtdesicomedyldn',
        title: 'Desi Comedy Uncensored',
        slug: 'desi-comedy-uncensored',
        summary: 'Five comics, one Limehouse stage, and absolutely no material about arranged marriage. Probably.',
        description: [
            'A stand-up night built around British-Asian comics who are tired of doing the same five jokes about their mothers. The rule for the bill is simple: no aunty material, no mispronunciation bits, no accents-for-laughs.',
            'Headlining is Aisha Rahman, fresh off a sold-out Edinburgh run, with support from four comics on the London circuit and one open spot chosen from submissions the week before.',
            'Strong language throughout and an unapologetic amount of material about the Home Office. Eighteen plus. Doors seven, show eight.'
        ].join('\n\n'),
        category: 'COMEDY',
        startsAt: daysFromNow(16, 19, 0),
        endsAt: daysFromNow(16, 22, 0),
        timezone: 'Europe/London',
        languages: [
            'English'
        ],
        organization: ORGANIZATIONS.masala,
        venue: VENUES.troxy,
        currency: 'GBP',
        tiers: [
            {
                id: 'ttcomedyfronttable',
                name: 'Front Table (seats 4)',
                description: 'Close enough to be part of the show. You have been warned.',
                priceCents: 9600,
                quantityTotal: 30,
                quantitySold: 27,
                minPerOrder: 1,
                maxPerOrder: 2
            },
            {
                id: 'ttcomedystandard',
                name: 'Standard Seated',
                description: 'Reserved seating in the stalls.',
                priceCents: 2800,
                quantityTotal: 800,
                quantitySold: 512,
                minPerOrder: 1,
                maxPerOrder: 8
            }
        ]
    },
    {
        id: 'evtdiwalimelato',
        title: 'Diwali Mela on the Square',
        slug: 'diwali-mela-on-the-square',
        summary: 'A free-to-roam Diwali mela in Mississauga with a rangoli competition, a night bazaar and a drone light show at nine.',
        description: [
            'Celebration Square becomes a mela for one weekend: a night bazaar of forty vendors, a rangoli competition open to anyone who turns up with chalk, a kids’ diya-painting tent, and food trucks from Malton to Markham.',
            'The main stage runs continuously from two in the afternoon — bhangra teams, a garba hour, a Tamil isai set and a closing Bollywood medley. At nine the lights go down for a three-hundred-drone show over the square, which is the reason half the crowd comes.',
            'The square itself is free. A Mela Pass gets you a reserved seat at the main stage, early entry to the bazaar and a voucher book for the food trucks.'
        ].join('\n\n'),
        category: 'CULTURAL_FESTIVAL',
        startsAt: daysFromNow(44, 18, 0),
        endsAt: daysFromNow(45, 4, 0),
        timezone: 'America/Toronto',
        languages: [
            'English',
            'Hindi',
            'Punjabi',
            'Tamil'
        ],
        organization: ORGANIZATIONS.desiBeats,
        venue: VENUES.celebrationSquare,
        currency: 'CAD',
        tiers: [
            {
                id: 'ttdiwalimelapass',
                name: 'Mela Pass',
                description: 'Reserved main-stage seating, early bazaar entry and a food-truck voucher book.',
                priceCents: 4000,
                quantityTotal: 1500,
                quantitySold: 388,
                minPerOrder: 1,
                maxPerOrder: 8
            },
            {
                id: 'ttdiwalifamilypass',
                name: 'Family Mela Pass (2 adults, 3 children)',
                description: 'Everything in the Mela Pass, for a household.',
                priceCents: 12_000,
                quantityTotal: 500,
                quantitySold: 141,
                minPerOrder: 1,
                maxPerOrder: 3
            },
            {
                id: 'ttdiwalisquareentry',
                name: 'Square Entry',
                description: 'Free general admission. Ticketed so we can manage the gates.',
                priceCents: 0,
                quantityTotal: 9000,
                quantitySold: 4210,
                minPerOrder: 1,
                maxPerOrder: 10
            }
        ]
    },
    {
        id: 'evtgarbabootcampmum',
        title: 'Garba Bootcamp — Learn It In a Weekend',
        slug: 'garba-bootcamp-learn-it-in-a-weekend',
        summary: 'Two afternoons, four steps, zero prior experience assumed. Walk out able to hold your own in any circle.',
        description: [
            'Every year the same thing happens: you get dragged to a garba night, you spend forty minutes half a beat behind everybody else, and you go home having learned nothing. This is the fix.',
            'Two afternoons, capped at forty people. Saturday covers do taali and teen taali and how to read the circle so you are not the person going the wrong way. Sunday adds sanedo, hinch and the hand pattern for dodhiya, then runs the whole thing at speed with live dhol.',
            'No partner needed, no experience needed, no particular level of fitness needed. Wear something you can turn in.'
        ].join('\n\n'),
        category: 'WORKSHOP',
        startsAt: daysFromNow(6, 9, 30),
        endsAt: daysFromNow(7, 12, 30),
        timezone: 'Asia/Kolkata',
        languages: [
            'Gujarati',
            'Hindi',
            'English'
        ],
        organization: ORGANIZATIONS.rangmanch,
        venue: VENUES.nehruCentre,
        currency: 'INR',
        tiers: [
            {
                id: 'ttbootcampboth',
                name: 'Both Afternoons',
                description: 'Saturday and Sunday, including the live-dhol run-through.',
                priceCents: 180_000,
                quantityTotal: 40,
                quantitySold: 31,
                minPerOrder: 1,
                maxPerOrder: 4
            },
            {
                id: 'ttbootcampsatonly',
                name: 'Saturday Only',
                description: 'The two taali patterns and circle etiquette.',
                priceCents: 110_000,
                quantityTotal: 15,
                quantitySold: 15,
                minPerOrder: 1,
                maxPerOrder: 2
            }
        ]
    },
    {
        id: 'evtrayretroldn',
        title: 'Ray Retrospective — The Apu Trilogy',
        slug: 'ray-retrospective-the-apu-trilogy',
        summary: 'All three Apu films in 4K restoration across one Saturday, with an introduction from film historian Nasreen Munni Kabir.',
        description: [
            'Pather Panchali, Aparajito and Apur Sansar, screened in order across a single day in new 4K restorations struck from the recovered negatives. Roughly six hours of film, two long breaks, and a Bengali lunch served between the first and second.',
            'Nasreen Munni Kabir introduces the day and returns between films to talk about Ravi Shankar’s score, Subrata Mitra’s bounce lighting, and what the trilogy did to Indian cinema after 1955.',
            'Bengali with English subtitles. Ticket includes lunch and unlimited cha. This one sells out; the last time we ran it, it went in four days.'
        ].join('\n\n'),
        category: 'FILM_SCREENING',
        startsAt: daysFromNow(23, 9, 0),
        endsAt: daysFromNow(23, 20, 0),
        timezone: 'Europe/London',
        languages: [
            'Bengali',
            'English'
        ],
        organization: ORGANIZATIONS.masala,
        venue: VENUES.southbank,
        currency: 'GBP',
        tiers: [
            {
                id: 'ttraytrilogyday',
                name: 'Full Day — All Three Films',
                description: 'All three screenings, the introductions, lunch and cha.',
                priceCents: 4200,
                quantityTotal: 380,
                quantitySold: 292,
                minPerOrder: 1,
                maxPerOrder: 4
            },
            {
                id: 'ttraysinglefilm',
                name: 'Single Film',
                description: 'One screening of your choice, chosen at the box office.',
                priceCents: 1800,
                quantityTotal: 200,
                quantitySold: 96,
                minPerOrder: 1,
                maxPerOrder: 4
            }
        ]
    },
    {
        id: 'evtgujaratinatak',
        title: 'Ekla Cholo — A Gujarati Natak',
        slug: 'ekla-cholo-a-gujarati-natak',
        summary: 'A new two-act play about a Kutchi family splitting an ancestral house, staged at Tagore Hall with English surtitles.',
        description: [
            'Three siblings come back to Bhuj to divide a house none of them has lived in for twenty years. What starts as an argument about a property deed turns into an argument about who stayed, who left, and what either of those was worth.',
            'Written by Hiral Mehta and directed by Paresh Doshi, Ekla Cholo ran for six months in Mumbai before this Ahmedabad transfer. The cast of four play eleven characters across forty years.',
            'Performed in Gujarati with English surtitles. Two acts, one interval, and — according to every review so far — a last ten minutes that nobody sees coming.'
        ].join('\n\n'),
        category: 'THEATRE',
        startsAt: daysFromNow(30, 13, 45),
        endsAt: daysFromNow(30, 16, 15),
        timezone: 'Asia/Kolkata',
        languages: [
            'Gujarati',
            'English'
        ],
        organization: ORGANIZATIONS.navrang,
        venue: VENUES.tagoreHall,
        currency: 'INR',
        tiers: [
            {
                id: 'tteklastallsfront',
                name: 'Stalls — Rows A to H',
                description: 'Best sightlines for the surtitle screen.',
                priceCents: 120_000,
                quantityTotal: 240,
                quantitySold: 166,
                minPerOrder: 1,
                maxPerOrder: 6
            },
            {
                id: 'tteklastallsrear',
                name: 'Stalls — Rows J onward',
                description: 'Reserved seating towards the back of the hall.',
                priceCents: 70_000,
                quantityTotal: 300,
                quantitySold: 121,
                minPerOrder: 1,
                maxPerOrder: 8
            },
            {
                id: 'tteklabalcony',
                name: 'Balcony',
                description: 'Unreserved balcony seating.',
                priceCents: 35_000,
                quantityTotal: 160,
                quantitySold: 58,
                minPerOrder: 1,
                maxPerOrder: 8
            }
        ]
    }
];
const SAMPLE_EVENTS = Object.freeze(EVENT_DEFINITIONS.map(toEvent));
function toEventSummary(event) {
    const tiers = event.ticketTypes ?? [];
    const onSale = tiers.filter((tier)=>!tier.isSoldOut && tier.status === 'ON_SALE');
    const priced = onSale.length > 0 ? onSale : tiers;
    return {
        id: event.id,
        organizationId: event.organizationId,
        title: event.title,
        slug: event.slug,
        summary: event.summary,
        category: event.category,
        status: event.status,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        timezone: event.timezone,
        coverImageUrl: event.coverImageUrl ?? null,
        isOnline: event.isOnline ?? false,
        city: event.venue?.city ?? null,
        venueName: event.venue?.name ?? null,
        organizationName: event.organization?.name ?? null,
        organizationSlug: event.organization?.slug ?? null,
        minPriceCents: priced.length > 0 ? Math.min(...priced.map((tier)=>tier.priceCents)) : null,
        currency: priced[0]?.currency ?? null,
        soldOut: tiers.length > 0 && onSale.length === 0
    };
}
function sampleEventSummaries() {
    return SAMPLE_EVENTS.map(toEventSummary);
}
function findSampleEvent(slug) {
    if (typeof slug !== 'string') return null;
    return SAMPLE_EVENTS.find((event)=>event.slug === slug) ?? null;
}
function findSampleOrganizer(slug) {
    if (typeof slug !== 'string') return null;
    const organization = Object.values(ORGANIZATIONS).find((candidate)=>candidate.slug === slug);
    if (!organization) return null;
    const listed = SAMPLE_EVENTS.filter((event)=>event.organizationId === organization.id);
    const now = Date.now();
    /**
   * One event as the organiser page lists it.
   *
   * @param {object} event A sample event.
   * @returns {object} The listing entry.
   */ const entry = (event)=>({
            slug: event.slug,
            title: event.title,
            startsAt: event.startsAt,
            venueName: event.venue?.name ?? null
        });
    return {
        slug: organization.slug,
        name: organization.name,
        description: organization.description ?? null,
        websiteUrl: organization.websiteUrl ?? null,
        verified: isBadged(organization),
        refundPolicy: organization.refundPolicy ?? null,
        timezone: organization.timezone,
        upcomingEvents: listed.filter((event)=>Date.parse(event.startsAt) >= now).sort((left, right)=>Date.parse(left.startsAt) - Date.parse(right.startsAt)).map(entry),
        pastEvents: listed.filter((event)=>Date.parse(event.startsAt) < now).sort((left, right)=>Date.parse(right.startsAt) - Date.parse(left.startsAt)).map(entry)
    };
}
function sampleCities() {
    const cities = new Set(SAMPLE_EVENTS.map((event)=>event.venue?.city).filter(Boolean));
    return [
        ...cities
    ].sort((a, b)=>a.localeCompare(b));
}
}),
"[project]/packages/api-contract/src/client.js [app-rsc] (ecmascript) <locals>", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "createApiClient",
    ()=>createApiClient,
    "serialiseQuery",
    ()=>serialiseQuery,
    "splitInput",
    ()=>splitInput
]);
/**
 * A typed-by-convention HTTP client generated from the route table.
 *
 * Every route id becomes a nested method — `events.list` is
 * `client.events.list(...)` — so a route that is renamed or removed breaks
 * calling code immediately instead of failing at runtime against a 404.
 *
 * `fetch` is injected rather than closed over so tests can drive the client
 * with a stub and never touch the network.
 *
 * @module @desi-event/api-contract/client
 */ var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$api$2d$contract$2f$src$2f$errors$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/api-contract/src/errors.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$api$2d$contract$2f$src$2f$path$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/api-contract/src/path.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$api$2d$contract$2f$src$2f$routes$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/api-contract/src/routes.js [app-rsc] (ecmascript)");
;
;
;
;
/** Keys recognised in the structured call form, `{ params, query, body }`. */ const STRUCTURED_KEYS = Object.freeze([
    'params',
    'query',
    'body'
]);
/** Methods whose requests never carry a JSON body. */ const BODYLESS_METHODS = Object.freeze([
    'GET',
    'HEAD'
]);
function serialiseQuery(query = {}) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})){
        if (value === undefined || value === null) continue;
        for (const item of Array.isArray(value) ? value : [
            value
        ]){
            if (item === undefined || item === null) continue;
            search.append(key, encodeQueryValue(item));
        }
    }
    return search.toString();
}
/**
 * Render a single query value as a string.
 *
 * @param {unknown} value Scalar value to encode.
 * @returns {string} The string form sent on the wire.
 */ function encodeQueryValue(value) {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    return String(value);
}
/**
 * Fold path parameters into a request body so both agree on the same ids.
 *
 * Only applies to routes that actually carry a body, and only to plain-object
 * bodies — a body the caller deliberately made an array or a scalar is left
 * untouched.
 *
 * @param {ApiRoute} route Route descriptor.
 * @param {unknown} body The body as supplied by the caller.
 * @param {Record<string, unknown>} params Resolved path parameters.
 * @returns {unknown} The body to send.
 */ function mergeParamsIntoBody(route, body, params) {
    if (!route.body || BODYLESS_METHODS.includes(route.method)) return body;
    if (Object.keys(params).length === 0) return body;
    if (body === undefined || body === null) return {
        ...params
    };
    if (typeof body !== 'object' || Array.isArray(body)) return body;
    return {
        ...body,
        ...params
    };
}
/**
 * Whether a value may stand in for one of the structured request parts.
 *
 * @param {unknown} value Candidate value.
 * @returns {boolean} True for `undefined` and for non-array objects.
 */ function isObjectOrUndefined(value) {
    return value === undefined || typeof value === 'object' && value !== null && !Array.isArray(value);
}
function splitInput(route, input = {}) {
    const source = input ?? {};
    if (typeof source !== 'object' || Array.isArray(source)) {
        throw new __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$api$2d$contract$2f$src$2f$errors$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["ApiContractError"](`Route "${route.id}" expects an object argument`, {
            code: 'INVALID_INPUT',
            details: {
                id: route.id
            }
        });
    }
    const keys = Object.keys(source);
    // `{ query: 'garba' }` is a flat query, not the structured form; requiring
    // each recognised key to hold an object keeps that ambiguity from biting.
    const isStructured = keys.length > 0 && keys.every((key)=>STRUCTURED_KEYS.includes(key) && isObjectOrUndefined(source[key]));
    if (isStructured) {
        const params = source.params ?? {};
        return {
            params,
            query: source.query ?? {},
            body: mergeParamsIntoBody(route, source.body, params)
        };
    }
    /** @type {Record<string, unknown>} */ const params = {};
    /** @type {Record<string, unknown>} */ const rest = {
        ...source
    };
    for (const name of (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$api$2d$contract$2f$src$2f$path$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["pathParamNames"])(route.path)){
        if (name in rest) {
            params[name] = rest[name];
            delete rest[name];
        }
    }
    const acceptsBody = Boolean(route.body) && !BODYLESS_METHODS.includes(route.method);
    if (acceptsBody) return {
        params,
        query: {},
        body: mergeParamsIntoBody(route, rest, params)
    };
    if (route.query) return {
        params,
        query: rest,
        body: undefined
    };
    if (Object.keys(rest).length > 0) {
        throw new __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$api$2d$contract$2f$src$2f$errors$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["ApiContractError"](`Route "${route.id}" takes no query or body, but received: ${Object.keys(rest).join(', ')}`, {
            code: 'UNEXPECTED_INPUT',
            details: {
                id: route.id,
                keys: Object.keys(rest)
            }
        });
    }
    return {
        params,
        query: {},
        body: undefined
    };
}
/**
 * Resolve a token that may be a literal, a getter, or absent.
 *
 * @param {string|Function|null|undefined} token The configured token.
 * @returns {Promise<string|null>} The bearer token, or `null` when there is none.
 */ async function resolveToken(token) {
    const value = typeof token === 'function' ? await token() : token;
    return value ? String(value) : null;
}
/**
 * Read and parse a response body according to its content type.
 *
 * @param {Response} response The fetch response.
 * @returns {Promise<unknown>} Parsed JSON, raw text, or `null` for an empty body.
 */ async function parseBody(response) {
    if (response.status === 204 || response.status === 205) return null;
    const text = await response.text();
    if (text === '') return null;
    const contentType = response.headers?.get?.('content-type') ?? '';
    if (contentType.includes('json')) {
        try {
            return JSON.parse(text);
        } catch  {
            // A malformed JSON body is still evidence; hand it back verbatim rather
            // than replacing the server's message with a parse error.
            return text;
        }
    }
    return text;
}
function createApiClient(options = {}) {
    const { baseUrl, fetch: fetchImpl = globalThis.fetch, token = null, headers: defaultHeaders = {}, routes = __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$api$2d$contract$2f$src$2f$routes$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["apiRoutes"] } = options;
    if (!baseUrl || typeof baseUrl !== 'string') {
        throw new __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$api$2d$contract$2f$src$2f$errors$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["ApiContractError"]('createApiClient requires a string baseUrl', {
            code: 'MISSING_BASE_URL'
        });
    }
    if (typeof fetchImpl !== 'function') {
        throw new __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$api$2d$contract$2f$src$2f$errors$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["ApiContractError"]('createApiClient requires a fetch implementation', {
            code: 'MISSING_FETCH'
        });
    }
    /**
   * Perform one request against a route descriptor.
   *
   * @param {string} routeId Route id, e.g. `events.list`.
   * @param {Record<string, unknown>} [input] Path params, query and/or body.
   * @param {object} [callOptions] Per-call overrides.
   * @param {Record<string, string>} [callOptions.headers] Extra headers for this call.
   * @param {string|null} [callOptions.token] Token overriding the client-level one; `null` sends none.
   * @param {AbortSignal} [callOptions.signal] Abort signal.
   * @returns {Promise<unknown>} The parsed success body.
   * @throws {ApiClientError} On a non-2xx response or a transport failure.
   * @throws {ApiContractError} When the route id is unknown or the input cannot be placed.
   */ async function request(routeId, input = {}, callOptions = {}) {
        const route = routes.find((candidate)=>candidate.id === routeId);
        if (!route) {
            throw new __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$api$2d$contract$2f$src$2f$errors$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["ApiContractError"](`Unknown route id "${routeId}"`, {
                code: 'UNKNOWN_ROUTE'
            });
        }
        const { params, query, body } = splitInput(route, input);
        const search = serialiseQuery(query);
        const url = (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$api$2d$contract$2f$src$2f$path$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["joinUrl"])(baseUrl, (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$api$2d$contract$2f$src$2f$path$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["buildPath"])(route.path, params)) + (search ? `?${search}` : '');
        /** @type {Record<string, string>} */ const headers = {
            accept: 'application/json',
            ...defaultHeaders,
            ...callOptions.headers ?? {}
        };
        const hasToken = Object.prototype.hasOwnProperty.call(callOptions, 'token');
        const bearer = await resolveToken(hasToken ? callOptions.token : token);
        if (bearer && route.auth !== 'none') headers.authorization = `Bearer ${bearer}`;
        /** @type {RequestInit} */ const init = {
            method: route.method,
            headers
        };
        if (body !== undefined && !BODYLESS_METHODS.includes(route.method)) {
            headers['content-type'] = 'application/json';
            init.body = JSON.stringify(body);
        }
        if (callOptions.signal) init.signal = callOptions.signal;
        let response;
        try {
            response = await fetchImpl(url, init);
        } catch (cause) {
            throw new __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$api$2d$contract$2f$src$2f$errors$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["ApiClientError"](`Request to ${route.method} ${url} failed: ${cause?.message ?? cause}`, {
                status: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$api$2d$contract$2f$src$2f$errors$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["NETWORK_ERROR_STATUS"],
                code: 'NETWORK_ERROR',
                method: route.method,
                url,
                routeId: route.id,
                cause
            });
        }
        const parsed = await parseBody(response);
        if (!response.ok) {
            throw new __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$api$2d$contract$2f$src$2f$errors$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["ApiClientError"](errorMessage(route, response, parsed), {
                status: response.status,
                body: parsed,
                method: route.method,
                url,
                routeId: route.id
            });
        }
        return parsed;
    }
    /** @type {Record<string, unknown>} */ const client = {
        request,
        /**
     * Derive a client that sends a different bearer token.
     *
     * @param {string|Function|null} nextToken Token for the derived client.
     * @returns {object} A new client sharing this one's baseUrl, fetch and headers.
     */ withToken (nextToken) {
            return createApiClient({
                ...options,
                token: nextToken
            });
        }
    };
    for (const route of routes){
        attachRoute(client, route, request);
    }
    return client;
}
/**
 * Hang a route's method off the client at its dotted id.
 *
 * @param {Record<string, unknown>} client The client object being assembled.
 * @param {ApiRoute} route Route descriptor.
 * @param {Function} request The shared request function.
 * @returns {void}
 * @throws {ApiContractError} When two route ids claim the same method name.
 */ function attachRoute(client, route, request) {
    const segments = route.id.split('.');
    const methodName = segments.pop();
    let target = client;
    for (const segment of segments){
        if (!target[segment]) target[segment] = {};
        target = target[segment];
    }
    if (target[methodName]) {
        throw new __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$api$2d$contract$2f$src$2f$errors$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["ApiContractError"](`Duplicate client method for route id "${route.id}"`, {
            code: 'DUPLICATE_ROUTE_ID',
            details: {
                id: route.id
            }
        });
    }
    /**
   * @param {Record<string, unknown>} [input] Path params, query and/or body.
   * @param {object} [callOptions] Per-call overrides.
   * @returns {Promise<unknown>} The parsed success body.
   */ target[methodName] = (input, callOptions)=>request(route.id, input, callOptions);
    Object.defineProperty(target[methodName], 'name', {
        value: route.id
    });
}
/**
 * Compose the message for a failed request, preferring the server's own words.
 *
 * @param {ApiRoute} route Route descriptor.
 * @param {Response} response The failing response.
 * @param {unknown} body Parsed response body.
 * @returns {string} A message suitable for logs.
 */ function errorMessage(route, response, body) {
    const serverMessage = body && typeof body === 'object' && typeof body.error?.message === 'string' ? body.error.message : null;
    const suffix = serverMessage ? `: ${serverMessage}` : '';
    return `${route.method} ${route.path} failed with ${response.status}${suffix}`;
}
}),
"[project]/packages/api-contract/src/errors.js [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/**
 * Error types raised by `@desi-event/api-contract`.
 *
 * Two failure modes are kept apart on purpose. `ApiContractError` means the
 * contract itself — or the way a caller used it — is wrong, which is a bug to
 * be fixed at build time. `ApiClientError` means a perfectly well-formed call
 * came back unhappy from a running server, which callers are expected to catch
 * and render.
 *
 * @module @desi-event/api-contract/errors
 */ /** Status reported for failures that never reached an HTTP response. */ __turbopack_context__.s([
    "ApiClientError",
    ()=>ApiClientError,
    "ApiContractError",
    ()=>ApiContractError,
    "NETWORK_ERROR_STATUS",
    ()=>NETWORK_ERROR_STATUS,
    "isApiClientError",
    ()=>isApiClientError
]);
const NETWORK_ERROR_STATUS = 0;
class ApiContractError extends Error {
    /**
   * @param {string} message Human-readable explanation.
   * @param {object} [options] Extra detail.
   * @param {string} [options.code] Machine-readable code.
   * @param {unknown} [options.details] Arbitrary supporting data.
   * @param {unknown} [options.cause] Underlying error, if any.
   */ constructor(message, options = {}){
        const { code = 'API_CONTRACT_ERROR', details, cause } = options;
        super(message, cause === undefined ? undefined : {
            cause
        });
        this.name = 'ApiContractError';
        this.code = code;
        this.statusCode = 500;
        this.details = details;
    }
}
class ApiClientError extends Error {
    /**
   * @param {string} message Human-readable explanation.
   * @param {object} [options] Response detail.
   * @param {number} [options.status] HTTP status code; `0` when the request never completed.
   * @param {unknown} [options.body] Parsed response body, if there was one.
   * @param {string} [options.code] Machine-readable code, normally `body.error.code`.
   * @param {string} [options.method] HTTP method that was attempted.
   * @param {string} [options.url] Fully resolved request URL.
   * @param {string} [options.routeId] Contract route id that produced the request.
   * @param {unknown} [options.cause] Underlying error, if any.
   */ constructor(message, options = {}){
        const { status = NETWORK_ERROR_STATUS, body = null, code, method, url, routeId, cause } = options;
        super(message, cause === undefined ? undefined : {
            cause
        });
        this.name = 'ApiClientError';
        this.status = status;
        this.statusCode = status;
        this.body = body;
        this.code = code ?? deriveCode(body, status);
        this.method = method;
        this.url = url;
        this.routeId = routeId;
    }
    /** @returns {boolean} True when the request never produced an HTTP response. */ get isNetworkError() {
        return this.status === NETWORK_ERROR_STATUS;
    }
}
/**
 * Pull the machine-readable code out of a `errorResponseSchema` envelope.
 *
 * @param {unknown} body Parsed response body.
 * @param {number} status HTTP status code, used for the fallback.
 * @returns {string} The server's error code, or a status-derived fallback.
 */ function deriveCode(body, status) {
    if (body && typeof body === 'object' && 'error' in body) {
        const envelope = /** @type {{error?: {code?: unknown}}} */ body.error;
        if (envelope && typeof envelope === 'object' && typeof envelope.code === 'string') {
            return envelope.code;
        }
    }
    return status === NETWORK_ERROR_STATUS ? 'NETWORK_ERROR' : `HTTP_${status}`;
}
function isApiClientError(value) {
    return value instanceof ApiClientError || value instanceof Error && value.name === 'ApiClientError';
}
}),
"[project]/packages/api-contract/src/index.js [app-rsc] (ecmascript) <locals>", ((__turbopack_context__) => {
"use strict";

/**
 * `@desi-event/api-contract` — the REST surface, described once.
 *
 * The Fastify server, the Next.js client and the generated OpenAPI document all
 * read from {@link apiRoutes}. Nothing else in the monorepo is allowed to
 * hard-code a URL, which is what keeps the server and the browser from drifting
 * apart in a repository with no compiler to notice.
 *
 * @module @desi-event/api-contract
 */ __turbopack_context__.s([]);
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$api$2d$contract$2f$src$2f$path$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/api-contract/src/path.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$api$2d$contract$2f$src$2f$routes$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/api-contract/src/routes.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$api$2d$contract$2f$src$2f$openapi$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/api-contract/src/openapi.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$api$2d$contract$2f$src$2f$client$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/packages/api-contract/src/client.js [app-rsc] (ecmascript) <locals>"); // `validate.js` is deliberately NOT re-exported here. It is a build- and
 // CI-time check over the whole contract, it is the only module in this package
 // that reaches outside it, and anything importing this barrel is very often a
 // browser. It lives at `@desi-event/api-contract/validate` so that reaching for
 // it is a decision rather than a side effect of importing the client.
;
;
;
;
;
}),
"[project]/packages/api-contract/src/openapi.js [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "BEARER_SCHEME_NAME",
    ()=>BEARER_SCHEME_NAME,
    "OPENAPI_VERSION",
    ()=>OPENAPI_VERSION,
    "SESSION_SCHEME_NAME",
    ()=>SESSION_SCHEME_NAME,
    "buildOpenApiDocument",
    ()=>buildOpenApiDocument,
    "buildOperation",
    ()=>buildOperation,
    "documentedErrorStatuses",
    ()=>documentedErrorStatuses,
    "hoistDefinitions",
    ()=>hoistDefinitions,
    "toJsonSchema",
    ()=>toJsonSchema
]);
/**
 * OpenAPI 3.1 generation from the route table.
 *
 * Zod is the only description of a payload in this repository, so the document
 * is derived rather than hand-maintained: if a schema changes, the spec changes
 * with it and cannot silently go stale.
 *
 * @module @desi-event/api-contract/openapi
 */ var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/zod@4.6.5/node_modules/zod/v4/classic/external.js [app-rsc] (ecmascript) <export * as z>");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$api$2d$contract$2f$src$2f$errors$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/api-contract/src/errors.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$api$2d$contract$2f$src$2f$path$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/api-contract/src/path.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$api$2d$contract$2f$src$2f$routes$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/api-contract/src/routes.js [app-rsc] (ecmascript)");
;
;
;
;
const OPENAPI_VERSION = '3.1.0';
const BEARER_SCHEME_NAME = 'bearerAuth';
const SESSION_SCHEME_NAME = 'sessionCookie';
/**
 * OpenAPI 3.1 embeds JSON Schema 2020-12 verbatim, so that is the target we
 * ask Zod for. `unrepresentable: 'any'` keeps constructs like `z.date()` from
 * throwing — they degrade to an unconstrained schema instead of taking the
 * whole document down.
 *
 * @type {{target: string, unrepresentable: string}}
 */ const BASE_JSON_SCHEMA_OPTIONS = {
    target: 'draft-2020-12',
    unrepresentable: 'any'
};
function toJsonSchema(schema, io = 'input') {
    let converted;
    try {
        converted = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].toJSONSchema(schema, {
            ...BASE_JSON_SCHEMA_OPTIONS,
            io
        });
    } catch (cause) {
        throw new __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$api$2d$contract$2f$src$2f$errors$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["ApiContractError"](`Cannot render schema to JSON Schema (io: ${io})`, {
            code: 'SCHEMA_NOT_REPRESENTABLE',
            details: {
                io
            },
            cause
        });
    }
    const { $schema: _dialect, ...rest } = converted;
    return rest;
}
/**
 * Rewrite `#/$defs/...` pointers so they resolve from the document root.
 *
 * Zod emits definitions local to whichever schema it was handed. Once that
 * fragment is embedded under `paths`, a local pointer no longer resolves, so
 * the definitions are hoisted into `components.schemas` and every reference is
 * repointed at the new home.
 *
 * @param {unknown} node The fragment to rewrite; walked recursively.
 * @param {Record<string, string>} renames Map of original `$defs` key to component name.
 * @returns {unknown} A rewritten copy; the input is not mutated.
 */ function rewriteRefs(node, renames) {
    if (Array.isArray(node)) return node.map((item)=>rewriteRefs(item, renames));
    if (!node || typeof node !== 'object') return node;
    /** @type {Record<string, unknown>} */ const out = {};
    for (const [key, value] of Object.entries(node)){
        if (key === '$ref' && typeof value === 'string' && value.startsWith('#/$defs/')) {
            const name = value.slice('#/$defs/'.length);
            out.$ref = `#/components/schemas/${renames[name] ?? name}`;
            continue;
        }
        out[key] = rewriteRefs(value, renames);
    }
    return out;
}
function hoistDefinitions(fragment, prefix, components) {
    const { $defs: defs, ...rest } = fragment ?? {};
    if (!defs || Object.keys(defs).length === 0) return rest;
    const safePrefix = prefix.replace(/[^A-Za-z0-9_.-]/g, '_');
    /** @type {Record<string, string>} */ const renames = {};
    for (const name of Object.keys(defs)){
        renames[name] = `${safePrefix}.${name}`;
    }
    for (const [name, definition] of Object.entries(defs)){
        components[renames[name]] = rewriteRefs(definition, renames);
    }
    return rewriteRefs(rest, renames);
}
/**
 * Build the `parameters` array for one location from an object schema.
 *
 * Deriving these from the generated JSON Schema rather than from Zod internals
 * means `.superRefine()`-wrapped objects (the listing query, for one) still
 * yield their properties.
 *
 * @param {ZodType|null} schema Object schema describing the location, or `null`.
 * @param {'path'|'query'} location Where the parameters travel.
 * @param {string} routeId Owning route id, used for hoisted definition names.
 * @param {Record<string, object>} components The document's `components.schemas` bag.
 * @param {string[]} [required] Parameter names that must be treated as required regardless of the schema.
 * @returns {object[]} OpenAPI parameter objects, ordered by property name for stability.
 */ function buildParameters(schema, location, routeId, components, required = []) {
    if (!schema) {
        return required.map((name)=>({
                name,
                in: location,
                required: true,
                schema: {
                    type: 'string'
                }
            }));
    }
    const fragment = hoistDefinitions(toJsonSchema(schema, 'input'), `${routeId}.${location}`, components);
    const properties = fragment.properties ?? {};
    const declaredRequired = new Set([
        ...fragment.required ?? [],
        ...required
    ]);
    const names = new Set([
        ...Object.keys(properties),
        ...required
    ]);
    return [
        ...names
    ].map((name)=>{
        const propertySchema = properties[name] ?? {
            type: 'string'
        };
        const { description, ...schemaRest } = propertySchema;
        /** @type {Record<string, unknown>} */ const parameter = {
            name,
            in: location,
            // A path parameter is part of the URL, so it is required by definition.
            required: location === 'path' ? true : declaredRequired.has(name),
            schema: schemaRest
        };
        if (description) parameter.description = description;
        return parameter;
    });
}
/**
 * Build the `responses` object for a route.
 *
 * @param {ApiRoute} route Route descriptor.
 * @param {Record<string, object>} components The document's `components.schemas` bag.
 * @returns {object} An OpenAPI responses object keyed by status code.
 */ function buildResponses(route, components) {
    const success = hoistDefinitions(toJsonSchema(route.response, 'output'), `${route.id}.response`, components);
    /** @type {Record<string, object>} */ const responses = {
        [String(route.successStatus)]: {
            description: route.summary,
            content: {
                'application/json': {
                    schema: success
                }
            }
        }
    };
    for (const error of route.errors){
        // A status declared twice keeps its first description; the catalogue makes
        // that a non-issue in practice but the guard keeps generation total.
        if (responses[String(error.status)]) continue;
        responses[String(error.status)] = {
            description: error.description,
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/ErrorResponse'
                    }
                }
            }
        };
    }
    return responses;
}
function buildOperation(route, components) {
    const parameters = [
        ...buildParameters(route.params, 'path', route.id, components, (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$api$2d$contract$2f$src$2f$path$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["pathParamNames"])(route.path)),
        ...buildParameters(route.query, 'query', route.id, components)
    ];
    /** @type {Record<string, unknown>} */ const operation = {
        operationId: route.id,
        summary: route.summary,
        description: route.description,
        tags: [
            ...route.tags
        ],
        responses: buildResponses(route, components)
    };
    if (parameters.length > 0) operation.parameters = parameters;
    if (route.body) {
        operation.requestBody = {
            required: true,
            content: {
                'application/json': {
                    schema: hoistDefinitions(toJsonSchema(route.body, 'input'), `${route.id}.body`, components)
                }
            }
        };
    }
    if (route.auth === 'bearer') {
        operation.security = [
            {
                [BEARER_SCHEME_NAME]: []
            }
        ];
    } else if (route.auth === 'session') {
        // Two alternatives rather than two requirements: either satisfies the route,
        // and they carry the same secret.
        operation.security = [
            {
                [SESSION_SCHEME_NAME]: []
            },
            {
                [BEARER_SCHEME_NAME]: []
            }
        ];
    } else if (route.auth === 'optional') {
        // An empty requirement object means "no credentials also works".
        operation.security = [
            {},
            {
                [SESSION_SCHEME_NAME]: []
            },
            {
                [BEARER_SCHEME_NAME]: []
            }
        ];
    }
    if (route.capability) {
        // Documented in the description rather than as an OpenAPI construct, because
        // OpenAPI's scopes belong to OAuth flows and this is not one. A reader needs
        // to know which power the route asks for; a generator does not.
        operation.description = `${operation.description}\n\nRequires the \`${route.capability}\` capability.`;
    }
    if (route.stepUp) {
        operation.description = `${operation.description}\n\nRequires a recent step-up authentication: see \`POST /v1/auth/step-up\`.`;
    }
    return operation;
}
function buildOpenApiDocument(options = {}) {
    const { title = 'Desi-Event API', version = '1.0.0', description = 'Ticketing and discovery for South-Asian cultural events.', servers = [
        {
            url: 'http://127.0.0.1:4000',
            description: 'Local development'
        }
    ], tags = __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$api$2d$contract$2f$src$2f$routes$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["API_TAGS"], routes = __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$api$2d$contract$2f$src$2f$routes$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["apiRoutes"] } = options;
    /** @type {Record<string, object>} */ const componentSchemas = {};
    componentSchemas.ErrorResponse = hoistDefinitions(toJsonSchema(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$api$2d$contract$2f$src$2f$routes$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["apiErrorResponseSchema"], 'output'), 'ErrorResponse', componentSchemas);
    /** @type {Record<string, Record<string, object>>} */ const paths = {};
    for (const route of routes){
        const openApiPath = (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$api$2d$contract$2f$src$2f$path$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["toOpenApiPath"])(route.path);
        const method = route.method.toLowerCase();
        const pathItem = paths[openApiPath] ?? (paths[openApiPath] = {});
        if (pathItem[method]) {
            throw new __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$api$2d$contract$2f$src$2f$errors$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["ApiContractError"](`Duplicate operation ${route.method} ${route.path} (route "${route.id}")`, {
                code: 'DUPLICATE_ROUTE',
                details: {
                    id: route.id,
                    method: route.method,
                    path: route.path
                }
            });
        }
        pathItem[method] = buildOperation(route, componentSchemas);
    }
    return {
        openapi: OPENAPI_VERSION,
        info: {
            title,
            version,
            description
        },
        servers: servers.map((server)=>({
                ...server
            })),
        tags: tags.map((tag)=>({
                ...tag
            })),
        paths,
        components: {
            schemas: componentSchemas,
            securitySchemes: {
                [SESSION_SCHEME_NAME]: {
                    type: 'apiKey',
                    in: 'cookie',
                    name: '__Host-desi_session',
                    description: 'The session cookie set by `POST /v1/auth/login`. A state-changing request must also echo the `__Host-desi_csrf` cookie in the `x-desi-csrf` header and arrive from an expected origin. On a deployment served over plain HTTP the cookies lose their `__Host-` prefix.'
                },
                [BEARER_SCHEME_NAME]: {
                    type: 'http',
                    scheme: 'bearer',
                    description: 'The same session secret `POST /v1/auth/login` returns as `token`, presented as a bearer token instead of a cookie. Opaque, not a JWT: it is the key to a session row, so revoking the session revokes the token.'
                }
            }
        }
    };
}
function documentedErrorStatuses() {
    return [
        ...new Set(Object.values(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$api$2d$contract$2f$src$2f$routes$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["API_ERRORS"]).map((error)=>error.status))
    ].sort((a, b)=>a - b);
}
}),
"[project]/packages/api-contract/src/path.js [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "buildPath",
    ()=>buildPath,
    "joinUrl",
    ()=>joinUrl,
    "pathParamNames",
    ()=>pathParamNames,
    "routeShape",
    ()=>routeShape,
    "toOpenApiPath",
    ()=>toOpenApiPath
]);
/**
 * Path helpers shared by the OpenAPI builder and the HTTP client.
 *
 * Route descriptors declare Fastify-style paths (`/v1/events/:slug`). OpenAPI
 * wants `{slug}` and the client wants a concrete URL; deriving both from one
 * parser keeps the two representations from drifting apart.
 *
 * @module @desi-event/api-contract/path
 */ var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$api$2d$contract$2f$src$2f$errors$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/api-contract/src/errors.js [app-rsc] (ecmascript)");
;
/** A path segment that names a parameter, e.g. `:eventId`. */ const PARAM_SEGMENT = /^:([A-Za-z_][A-Za-z0-9_]*)$/;
/**
 * Split a route path into segments, dropping the empty leading segment.
 *
 * @param {string} path Fastify-style route path.
 * @returns {string[]} Non-empty path segments.
 */ function segmentsOf(path) {
    return path.split('/').filter((segment)=>segment.length > 0);
}
function pathParamNames(path) {
    const names = [];
    for (const segment of segmentsOf(path)){
        const match = PARAM_SEGMENT.exec(segment);
        if (match) names.push(match[1]);
    }
    return names;
}
function toOpenApiPath(path) {
    const converted = segmentsOf(path).map((segment)=>{
        const match = PARAM_SEGMENT.exec(segment);
        return match ? `{${match[1]}}` : segment;
    });
    return `/${converted.join('/')}`;
}
function buildPath(path, params = {}) {
    const source = params ?? {};
    const filled = segmentsOf(path).map((segment)=>{
        const match = PARAM_SEGMENT.exec(segment);
        if (!match) return segment;
        const name = match[1];
        const value = source[name];
        if (value === undefined || value === null || value === '') {
            throw new __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$api$2d$contract$2f$src$2f$errors$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["ApiContractError"](`Missing path parameter "${name}" for ${path}`, {
                code: 'MISSING_PATH_PARAM',
                details: {
                    path,
                    param: name
                }
            });
        }
        return encodeURIComponent(String(value));
    });
    return `/${filled.join('/')}`;
}
function joinUrl(baseUrl, path) {
    return `${String(baseUrl).replace(/\/+$/, '')}${path}`;
}
function routeShape(path) {
    const shaped = segmentsOf(path).map((segment)=>PARAM_SEGMENT.test(segment) ? '{}' : segment);
    return `/${shaped.join('/')}`;
}
}),
"[project]/packages/api-contract/src/routes.js [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "API_ERRORS",
    ()=>API_ERRORS,
    "API_TAGS",
    ()=>API_TAGS,
    "API_VERSION_PREFIX",
    ()=>API_VERSION_PREFIX,
    "AUTHENTICATED_MODES",
    ()=>AUTHENTICATED_MODES,
    "AUTH_MODES",
    ()=>AUTH_MODES,
    "HTTP_METHODS",
    ()=>HTTP_METHODS,
    "apiErrorResponseSchema",
    ()=>apiErrorResponseSchema,
    "apiRoutes",
    ()=>apiRoutes,
    "findRoute",
    ()=>findRoute,
    "routeById",
    ()=>routeById,
    "routeIds",
    ()=>routeIds,
    "routeKey",
    ()=>routeKey,
    "routeParamNames",
    ()=>routeParamNames,
    "routesByTag",
    ()=>routesByTag
]);
/**
 * The route table: the single source of truth for the Desi-Event HTTP API.
 *
 * The Fastify server registers handlers against these descriptors, the OpenAPI
 * document is generated from them, and the browser client is generated from
 * them too. A route that is not in this file does not exist as far as the rest
 * of the monorepo is concerned.
 *
 * @module @desi-event/api-contract/routes
 */ var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/zod@4.6.5/node_modules/zod/v4/classic/external.js [app-rsc] (ecmascript) <export * as z>");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$index$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/packages/schemas/src/index.js [app-rsc] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$teams$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/schemas/src/teams.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$auth$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/schemas/src/auth.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$requests$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/schemas/src/requests.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$seating$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/schemas/src/seating.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$verification$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/schemas/src/verification.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$payments$2d$wire$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/schemas/src/payments-wire.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$responses$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/schemas/src/responses.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/schemas/src/primitives.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$entities$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/schemas/src/entities.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$api$2d$contract$2f$src$2f$errors$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/api-contract/src/errors.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$api$2d$contract$2f$src$2f$path$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/api-contract/src/path.js [app-rsc] (ecmascript)");
;
;
;
;
const API_VERSION_PREFIX = '/v1';
const AUTH_MODES = Object.freeze([
    'none',
    'bearer',
    'optional',
    'session'
]);
const AUTHENTICATED_MODES = Object.freeze([
    'bearer',
    'session'
]);
const HTTP_METHODS = Object.freeze([
    'GET',
    'POST',
    'PATCH',
    'PUT',
    'DELETE'
]);
const API_TAGS = Object.freeze([
    {
        name: 'health',
        description: 'Liveness and readiness probes.'
    },
    {
        name: 'auth',
        description: 'Registration, sign-in and the current session.'
    },
    {
        name: 'teams',
        description: 'Organisation membership: who belongs, what they may do, and how they were invited.'
    },
    {
        name: 'organizers',
        description: 'Organiser verification, and the public page an organiser is judged by. Verification gates publishing and payouts, so its transitions are commands rather than a writable field.'
    },
    {
        name: 'events',
        description: 'Public event discovery and organiser event management.'
    },
    {
        name: 'ticket-types',
        description: 'Ticket tiers belonging to an event.'
    },
    {
        name: 'sessions',
        description: 'Performances of an event, and the seats on sale at each one.'
    },
    {
        name: 'holds',
        description: 'Short-lived inventory reservations taken during checkout.'
    },
    {
        name: 'orders',
        description: 'Checkout and order retrieval.'
    },
    {
        name: 'payments',
        description: 'Provider callbacks. The authoritative signal that money moved.'
    },
    {
        name: 'webhooks',
        description: 'Provider callbacks. The authoritative signal that money moved, verified over the exact bytes sent.'
    },
    {
        name: 'tickets',
        description: 'Door scanning and attendance.'
    },
    {
        name: 'waitlist',
        description: 'Waitlist sign-up for sold-out events.'
    }
]);
const API_ERRORS = Object.freeze({
    validation: Object.freeze({
        status: 400,
        code: 'VALIDATION_ERROR',
        description: 'The request failed schema validation; `error.issues` lists the offending fields.'
    }),
    unauthorized: Object.freeze({
        status: 401,
        code: 'UNAUTHORIZED',
        description: 'The bearer token is missing, malformed or expired.'
    }),
    forbidden: Object.freeze({
        status: 403,
        code: 'FORBIDDEN',
        description: 'The caller is authenticated but lacks the required capability.'
    }),
    /**
   * Used *instead of* `forbidden` on a route that requires step-up
   * authentication, because a route may document each status only once. The
   * description covers both reasons a 403 can arrive there.
   */ stepUpRequired: Object.freeze({
        status: 403,
        code: 'STEP_UP_REQUIRED',
        description: 'The caller lacks the required capability, or holds it but has not authenticated again recently enough for an action of this kind.'
    }),
    notFound: Object.freeze({
        status: 404,
        code: 'NOT_FOUND',
        description: 'No such resource, or it is not visible to this caller.'
    }),
    conflict: Object.freeze({
        status: 409,
        code: 'CONFLICT',
        description: 'The request collides with current state, e.g. a duplicate slug or a released hold.'
    }),
    gone: Object.freeze({
        status: 410,
        code: 'HOLD_EXPIRED',
        description: 'The inventory hold referenced by the request has already expired.'
    }),
    unprocessable: Object.freeze({
        status: 422,
        code: 'UNPROCESSABLE',
        description: 'Well-formed but not actionable, e.g. sold out or outside the sales window.'
    }),
    rateLimited: Object.freeze({
        status: 429,
        code: 'RATE_LIMITED',
        description: 'Too many attempts; retry after the interval in the `Retry-After` header.'
    }),
    unavailable: Object.freeze({
        status: 503,
        code: 'SERVICE_UNAVAILABLE',
        description: 'A dependency (database or Redis) is unreachable.'
    })
});
/** Path parameters for the routes nested under an organisation id. */ const organizationIdParamSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    id: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"]
});
/** Path parameters for the routes naming one membership or invitation within an organisation. */ const memberParamSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    id: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"],
    memberId: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"]
});
/** Path parameters for the routes keyed by a session id. */ const sessionIdParamSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    id: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"]
});
/** Path parameters for the routes nested under an event id. */ const eventIdParamSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    eventId: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"]
});
/** Path parameters for the customer-facing order lookup. */ const orderReferenceParamSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    reference: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["orderReferenceSchema"]
});
/** `POST /v1/events/:eventId/ticket-types`. */ const ticketTypeResponseSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    data: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$entities$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["ticketTypeSchema"]
});
/** `GET /v1/orders`. */ const orderListResponseSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    data: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].array(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$entities$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["orderWithItemsSchema"]),
    pagination: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$responses$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["paginationMetaSchema"]
});
/** `POST /v1/events/:eventId/waitlist`. */ const waitlistResponseSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    data: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$entities$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["waitlistEntrySchema"]
});
const apiRoutes = Object.freeze([
    {
        id: 'health.get',
        method: 'GET',
        path: '/health',
        summary: 'Service health',
        description: 'Unversioned liveness probe. Reports the database and Redis checks so a load balancer can drain an instance whose dependencies are down.',
        tags: [
            'health'
        ],
        auth: 'none',
        params: null,
        query: null,
        body: null,
        response: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$responses$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["healthResponseSchema"],
        successStatus: 200,
        errors: [
            API_ERRORS.unavailable
        ]
    },
    {
        id: 'auth.register',
        method: 'POST',
        path: '/v1/auth/register',
        summary: 'Create an account',
        description: 'Self-service sign-up. Only the ATTENDEE and ORGANIZER roles may be requested; every other role is granted out of band, and a request naming one is refused by schema. A session is established immediately, but `emailVerificationRequired` is true until the address is confirmed, and the routes that need a verified address say so.',
        tags: [
            'auth'
        ],
        auth: 'none',
        capability: null,
        params: null,
        query: null,
        body: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$auth$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerAccountRequestSchema"],
        response: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$auth$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["signInResponseSchema"],
        successStatus: 201,
        errors: [
            API_ERRORS.validation,
            API_ERRORS.conflict,
            API_ERRORS.rateLimited
        ]
    },
    {
        id: 'auth.login',
        method: 'POST',
        path: '/v1/auth/login',
        summary: 'Sign in',
        description: 'Exchange email and password for a session, returned both as a cookie and as a bearer token carrying the same secret. A wrong password and an unknown email answer identically, and both pay the same hashing cost, so neither the body nor the response time enumerates accounts. An account with a second factor and no code supplied answers 200 with `mfaRequired` rather than an error — an error would have to distinguish "wrong password" from "right password, now show a code", which tells an attacker which passwords are correct. Failures are counted per address and per source, and a caller past either threshold gets 429 with no indication of which counter tripped.',
        tags: [
            'auth'
        ],
        auth: 'none',
        capability: null,
        params: null,
        query: null,
        body: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$auth$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["signInRequestSchema"],
        response: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$auth$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["signInResponseSchema"],
        successStatus: 200,
        errors: [
            API_ERRORS.validation,
            API_ERRORS.unauthorized,
            API_ERRORS.rateLimited
        ]
    },
    {
        id: 'auth.logout',
        method: 'POST',
        path: '/v1/auth/logout',
        summary: 'Sign out',
        description: 'Revoke the session behind this request and clear its cookies. With `everywhere`, revoke every other session this account holds as well. Idempotent: signing out of an already-revoked session succeeds.',
        tags: [
            'auth'
        ],
        auth: 'session',
        mfaExempt: true,
        capability: null,
        params: null,
        query: null,
        body: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$auth$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["signOutRequestSchema"],
        response: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$responses$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["okResponseSchema"],
        successStatus: 200,
        errors: [
            API_ERRORS.validation,
            API_ERRORS.unauthorized
        ]
    },
    {
        id: 'auth.me',
        method: 'GET',
        path: '/v1/auth/me',
        summary: 'Current session',
        description: 'Who the caller is, what they may do, and the state of their session. Capabilities are resolved on every request rather than baked into a token, so a role revoked at 09:00 stops working at 09:00. Never includes the password hash, the session token, or any credential.',
        tags: [
            'auth'
        ],
        auth: 'session',
        mfaExempt: true,
        capability: null,
        params: null,
        query: null,
        body: null,
        response: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$auth$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["currentSessionResponseSchema"],
        successStatus: 200,
        errors: [
            API_ERRORS.unauthorized
        ]
    },
    {
        id: 'auth.verifyEmail',
        method: 'POST',
        path: '/v1/auth/verify-email',
        summary: 'Confirm an email address',
        description: 'Redeem a verification link. The token is single-use, enforced by a conditional update rather than by a read-then-write, so two simultaneous redemptions cannot both succeed. A token issued for any other purpose is refused even if it is otherwise valid.',
        tags: [
            'auth'
        ],
        auth: 'none',
        capability: null,
        params: null,
        query: null,
        body: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$auth$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["verifyEmailRequestSchema"],
        response: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$responses$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["okResponseSchema"],
        successStatus: 200,
        errors: [
            API_ERRORS.validation,
            API_ERRORS.unauthorized,
            API_ERRORS.rateLimited
        ]
    },
    {
        id: 'auth.resendVerification',
        method: 'POST',
        path: '/v1/auth/resend-verification',
        summary: 'Send the verification email again',
        description: 'Answers identically whether the address has an account, has already been verified, or has never been seen. Rate-limited, because an endpoint that sends mail on demand is an endpoint that sends mail to somebody else on demand.',
        tags: [
            'auth'
        ],
        auth: 'none',
        capability: null,
        params: null,
        query: null,
        body: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$auth$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["resendVerificationRequestSchema"],
        response: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$auth$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["acceptedResponseSchema"],
        successStatus: 202,
        errors: [
            API_ERRORS.validation,
            API_ERRORS.rateLimited
        ]
    },
    {
        id: 'auth.forgotPassword',
        method: 'POST',
        path: '/v1/auth/forgot-password',
        summary: 'Request a password reset',
        description: 'Issue a single-use reset link with a short lifetime. Answers identically for a known and an unknown address. Any reset token already outstanding for the account is revoked, so a link requested twice leaves exactly one usable link.',
        tags: [
            'auth'
        ],
        auth: 'none',
        capability: null,
        params: null,
        query: null,
        body: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$auth$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["forgotPasswordRequestSchema"],
        response: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$auth$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["acceptedResponseSchema"],
        successStatus: 202,
        errors: [
            API_ERRORS.validation,
            API_ERRORS.rateLimited
        ]
    },
    {
        id: 'auth.resetPassword',
        method: 'POST',
        path: '/v1/auth/reset-password',
        summary: 'Set a new password from a reset link',
        description: 'Redeem a reset token and replace the password. The token is single-use. Every session the account holds is revoked, including the one that may be making this request: a session established with the old password must stop working, or resetting the password because somebody else knows it accomplishes nothing.',
        tags: [
            'auth'
        ],
        auth: 'none',
        capability: null,
        params: null,
        query: null,
        body: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$auth$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["resetPasswordRequestSchema"],
        response: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$responses$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["okResponseSchema"],
        successStatus: 200,
        errors: [
            API_ERRORS.validation,
            API_ERRORS.unauthorized,
            API_ERRORS.rateLimited
        ]
    },
    {
        id: 'auth.changePassword',
        method: 'POST',
        path: '/v1/auth/change-password',
        summary: 'Change the password',
        description: 'Requires the current password even though the caller is already authenticated: a session is evidence of who they were when they signed in, not evidence that the person at the keyboard now knows the password. On success every other session is revoked and this one is rotated.',
        tags: [
            'auth'
        ],
        auth: 'session',
        mfaExempt: true,
        capability: null,
        params: null,
        query: null,
        body: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$auth$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["changePasswordRequestSchema"],
        response: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$responses$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["okResponseSchema"],
        successStatus: 200,
        errors: [
            API_ERRORS.validation,
            API_ERRORS.unauthorized,
            API_ERRORS.rateLimited
        ]
    },
    {
        id: 'auth.stepUp',
        method: 'POST',
        path: '/v1/auth/step-up',
        summary: 'Authenticate again for a sensitive action',
        description: 'Prove possession of the password or a second factor, marking the session as recently authenticated for a bounded window. Required by routes whose damage is not undoable. An account whose roles require a second factor must supply a code here; a password alone will not do.',
        tags: [
            'auth'
        ],
        auth: 'session',
        mfaExempt: true,
        capability: null,
        params: null,
        query: null,
        body: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$auth$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["stepUpRequestSchema"],
        response: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$responses$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["okResponseSchema"],
        successStatus: 200,
        errors: [
            API_ERRORS.validation,
            API_ERRORS.unauthorized,
            API_ERRORS.rateLimited
        ]
    },
    {
        id: 'auth.listSessions',
        method: 'GET',
        path: '/v1/auth/sessions',
        summary: 'List active sessions',
        description: 'Every session this account currently holds, with the current one flagged. Carries no token digests and no raw IP addresses — enough to recognise a session as yours or not, and nothing more.',
        tags: [
            'auth'
        ],
        auth: 'session',
        mfaExempt: true,
        capability: null,
        params: null,
        query: null,
        body: null,
        response: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$auth$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["sessionListResponseSchema"],
        successStatus: 200,
        errors: [
            API_ERRORS.unauthorized
        ]
    },
    {
        id: 'auth.revokeSession',
        method: 'POST',
        path: '/v1/auth/sessions/:id/revoke',
        summary: 'End a session',
        description: "End one session, which may be the caller's own. A session belonging to another account answers 404 rather than 403, so the endpoint cannot be used to discover whether a session id exists. Idempotent.",
        tags: [
            'auth'
        ],
        auth: 'session',
        mfaExempt: true,
        capability: null,
        params: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$requests$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["idParamSchema"],
        query: null,
        body: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$auth$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["revokeRequestSchema"],
        response: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$responses$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["okResponseSchema"],
        successStatus: 200,
        errors: [
            API_ERRORS.validation,
            API_ERRORS.unauthorized,
            API_ERRORS.notFound
        ]
    },
    {
        id: 'auth.listDevices',
        method: 'GET',
        path: '/v1/auth/devices',
        summary: 'List known devices',
        description: 'Browsers and apps this account has signed in from, with how many live sessions each currently has. The stored fingerprint digest is never returned.',
        tags: [
            'auth'
        ],
        auth: 'session',
        mfaExempt: true,
        capability: null,
        params: null,
        query: null,
        body: null,
        response: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$auth$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["deviceListResponseSchema"],
        successStatus: 200,
        errors: [
            API_ERRORS.unauthorized
        ]
    },
    {
        id: 'auth.revokeDevice',
        method: 'POST',
        path: '/v1/auth/devices/:id/revoke',
        summary: 'Revoke a device',
        description: 'Revoke a device and every session established from it. A device belonging to another account answers 404. Idempotent.',
        tags: [
            'auth'
        ],
        auth: 'session',
        mfaExempt: true,
        capability: null,
        params: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$requests$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["idParamSchema"],
        query: null,
        body: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$auth$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["revokeRequestSchema"],
        response: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$responses$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["okResponseSchema"],
        successStatus: 200,
        errors: [
            API_ERRORS.validation,
            API_ERRORS.unauthorized,
            API_ERRORS.notFound
        ]
    },
    {
        id: 'auth.listFactors',
        method: 'GET',
        path: '/v1/auth/mfa',
        summary: 'List second factors',
        description: "This account's enrolled factors, whether its roles require one, and whether that requirement is satisfied. Never returns a secret or a recovery code.",
        tags: [
            'auth'
        ],
        auth: 'session',
        mfaExempt: true,
        capability: null,
        params: null,
        query: null,
        body: null,
        response: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$auth$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["mfaFactorListResponseSchema"],
        successStatus: 200,
        errors: [
            API_ERRORS.unauthorized
        ]
    },
    {
        id: 'auth.enrollTotp',
        method: 'POST',
        path: '/v1/auth/mfa/totp',
        summary: 'Begin TOTP enrolment',
        description: 'Generate a TOTP secret and return it once, with the provisioning URI an authenticator app scans. The factor is unusable until confirmed, so an abandoned enrolment leaves an unconfirmed row rather than a second factor nobody can produce a code for. The secret is sealed at rest and never returned again.',
        tags: [
            'auth'
        ],
        auth: 'session',
        mfaExempt: true,
        capability: null,
        params: null,
        query: null,
        body: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$auth$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["enrollTotpRequestSchema"],
        response: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$auth$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["totpEnrollmentResponseSchema"],
        successStatus: 201,
        errors: [
            API_ERRORS.validation,
            API_ERRORS.unauthorized,
            API_ERRORS.rateLimited
        ]
    },
    {
        id: 'auth.confirmTotp',
        method: 'POST',
        path: '/v1/auth/mfa/totp/confirm',
        summary: 'Confirm TOTP enrolment',
        description: 'Prove the authenticator holds the secret, activating the factor and returning a set of single-use recovery codes. The codes appear once: they are stored as digests, so losing them means generating a new set. Every other session is revoked, because adding a factor is a privilege change.',
        tags: [
            'auth'
        ],
        auth: 'session',
        mfaExempt: true,
        capability: null,
        params: null,
        query: null,
        body: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$auth$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["confirmTotpRequestSchema"],
        response: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$auth$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["totpConfirmedResponseSchema"],
        successStatus: 200,
        errors: [
            API_ERRORS.validation,
            API_ERRORS.unauthorized,
            API_ERRORS.notFound,
            API_ERRORS.rateLimited
        ]
    },
    {
        id: 'auth.disableFactor',
        method: 'POST',
        path: '/v1/auth/mfa/:id/disable',
        summary: 'Remove a second factor',
        description: 'Disable a factor. Gated on the current password and on a recent step-up, because removing a factor is the action an attacker who has stolen a session would most like to perform. Removing the last confirmed factor from an account whose roles require one is refused: the account would keep its authority and lose its second factor.',
        tags: [
            'auth'
        ],
        auth: 'session',
        mfaExempt: true,
        capability: null,
        stepUp: 'CREDENTIAL',
        params: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$requests$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["idParamSchema"],
        query: null,
        body: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$auth$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["disableMfaRequestSchema"],
        response: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$responses$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["okResponseSchema"],
        successStatus: 200,
        errors: [
            API_ERRORS.validation,
            API_ERRORS.unauthorized,
            API_ERRORS.stepUpRequired,
            API_ERRORS.notFound,
            API_ERRORS.unprocessable
        ]
    },
    {
        id: 'teams.list',
        method: 'GET',
        path: '/v1/organizations/:id/members',
        summary: 'List the team',
        description: "Everybody in this organisation, the invitations still outstanding, and the roles the caller may grant. The role list is computed from what the caller holds rather than fixed, because a member cannot grant a power they do not have. Carries each person's name and address and nothing else about their account: managing a team is not the same as reading a colleague's profile.",
        tags: [
            'teams'
        ],
        auth: 'session',
        capability: 'organization:view_members',
        capabilityScope: 'params.id',
        params: organizationIdParamSchema,
        query: null,
        body: null,
        response: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$teams$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["memberListResponseSchema"],
        successStatus: 200,
        errors: [
            API_ERRORS.unauthorized,
            API_ERRORS.forbidden,
            API_ERRORS.notFound
        ]
    },
    {
        id: 'teams.invite',
        method: 'POST',
        path: '/v1/organizations/:id/invitations',
        summary: 'Invite somebody to the team',
        description: 'Issue a single-use invitation to an email address, for a role bounded by what the caller holds: a member cannot invite somebody to a role that carries powers they lack, and OWNER cannot be invited at all. An address that already belongs to the organisation answers 409, and a second invitation to the same address supersedes the first rather than leaving two live links.',
        tags: [
            'teams'
        ],
        auth: 'session',
        capability: 'team:invite',
        capabilityScope: 'params.id',
        params: organizationIdParamSchema,
        query: null,
        body: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$teams$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["inviteMemberRequestSchema"],
        response: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$teams$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["invitationResponseSchema"],
        successStatus: 201,
        errors: [
            API_ERRORS.validation,
            API_ERRORS.unauthorized,
            API_ERRORS.forbidden,
            API_ERRORS.notFound,
            API_ERRORS.conflict
        ]
    },
    {
        id: 'teams.accept',
        method: 'POST',
        path: '/v1/invitations/accept',
        summary: 'Accept an invitation',
        description: 'Join an organisation with an invitation link. The caller must be signed in as the address the invitation names — a link forwarded to somebody else does not work, which is what stops an invitation becoming a transferable key. Single-use, enforced by a conditional update, so two simultaneous acceptances produce one membership.',
        tags: [
            'teams'
        ],
        auth: 'session',
        capability: null,
        params: null,
        query: null,
        body: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$teams$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["acceptInvitationRequestSchema"],
        response: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$teams$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["acceptedInvitationResponseSchema"],
        successStatus: 200,
        errors: [
            API_ERRORS.validation,
            API_ERRORS.unauthorized,
            API_ERRORS.forbidden,
            API_ERRORS.conflict
        ]
    },
    {
        id: 'teams.revokeInvitation',
        method: 'POST',
        path: '/v1/organizations/:id/invitations/:memberId/revoke',
        summary: 'Withdraw an invitation',
        description: 'Stop an outstanding invitation from being accepted. Idempotent, and an invitation belonging to another organisation answers 404 rather than 403.',
        tags: [
            'teams'
        ],
        auth: 'session',
        capability: 'team:invite',
        capabilityScope: 'params.id',
        params: memberParamSchema,
        query: null,
        body: null,
        response: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$responses$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["okResponseSchema"],
        successStatus: 200,
        errors: [
            API_ERRORS.unauthorized,
            API_ERRORS.forbidden,
            API_ERRORS.notFound
        ]
    },
    {
        id: 'teams.updateMember',
        method: 'PATCH',
        path: '/v1/organizations/:id/members/:memberId',
        summary: "Change a member's role",
        description: 'Bounded three ways. The caller must be able to grant the new role and must already hold power over the old one, so nobody can promote somebody past themselves or demote somebody above them. Nobody may change their own role, which is what stops a MANAGER making themselves an ADMIN. And the last OWNER cannot be demoted: an organisation with no owner is one nobody can fix.',
        tags: [
            'teams'
        ],
        auth: 'session',
        capability: 'team:role_manage',
        capabilityScope: 'params.id',
        params: memberParamSchema,
        query: null,
        body: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$teams$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["updateMemberRequestSchema"],
        response: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$responses$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["okResponseSchema"],
        successStatus: 200,
        errors: [
            API_ERRORS.validation,
            API_ERRORS.unauthorized,
            API_ERRORS.forbidden,
            API_ERRORS.notFound,
            API_ERRORS.unprocessable
        ]
    },
    {
        id: 'teams.removeMember',
        method: 'POST',
        path: '/v1/organizations/:id/members/:memberId/remove',
        summary: 'Remove somebody from the team',
        description: 'Bounded like a role change, and with the same last-owner rule. Removing somebody revokes their scanner scopes with them. A membership in another organisation answers 404.',
        tags: [
            'teams'
        ],
        auth: 'session',
        capability: 'team:remove',
        capabilityScope: 'params.id',
        params: memberParamSchema,
        query: null,
        body: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$teams$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["removeMemberRequestSchema"],
        response: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$responses$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["okResponseSchema"],
        successStatus: 200,
        errors: [
            API_ERRORS.validation,
            API_ERRORS.unauthorized,
            API_ERRORS.forbidden,
            API_ERRORS.notFound,
            API_ERRORS.unprocessable
        ]
    },
    {
        id: 'organizers.verification',
        method: 'GET',
        path: '/v1/organizations/:id/verification',
        summary: 'Read the verification state and its history',
        description: 'The current state, whether the organisation may publish and be paid, and every transition it has been through with the reason recorded at the time. The history is append-only: a later decision is a new row, never an edit to an old one, because an audit trail that can be rewritten is a story rather than a record.',
        tags: [
            'organizers'
        ],
        auth: 'session',
        capability: 'organization:view_members',
        capabilityScope: 'params.id',
        params: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$requests$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["idParamSchema"],
        query: null,
        body: null,
        response: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$verification$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["verificationStateResponseSchema"],
        successStatus: 200,
        errors: [
            API_ERRORS.unauthorized,
            API_ERRORS.forbidden,
            API_ERRORS.notFound
        ]
    },
    {
        id: 'organizers.submitVerification',
        method: 'POST',
        path: '/v1/organizations/:id/verification',
        summary: 'Submit the organisation for verification',
        description: 'Moves the organisation into PENDING from UNVERIFIED, REQUIRES_INFORMATION, REJECTED or REVOKED. The body carries no target state: PENDING is the only place an organiser can go, and offering a field would imply a choice they do not have. A moderator decides what happens next.',
        tags: [
            'organizers'
        ],
        auth: 'session',
        capability: 'organization:submit_verification',
        capabilityScope: 'params.id',
        params: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$requests$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["idParamSchema"],
        query: null,
        body: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$verification$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["submitVerificationRequestSchema"],
        response: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$verification$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["verificationStateResponseSchema"],
        successStatus: 200,
        errors: [
            API_ERRORS.validation,
            API_ERRORS.unauthorized,
            API_ERRORS.forbidden,
            API_ERRORS.notFound,
            API_ERRORS.conflict
        ]
    },
    {
        id: 'organizers.moderateVerification',
        method: 'POST',
        path: '/v1/organizations/:id/verification/decision',
        summary: 'Decide a verification submission',
        description: 'Platform staff only, and a reason is required for every outcome: a verification decision nobody recorded a rationale for is one nobody can review or appeal. Requires a recent second factor under the SECURITY_ROLE policy, because verification is what gates publishing and payouts.',
        tags: [
            'organizers'
        ],
        auth: 'session',
        capability: 'moderation:review',
        stepUp: 'SECURITY_ROLE',
        params: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$requests$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["idParamSchema"],
        query: null,
        body: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$verification$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["moderateVerificationRequestSchema"],
        response: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$verification$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["verificationStateResponseSchema"],
        successStatus: 200,
        errors: [
            API_ERRORS.validation,
            API_ERRORS.unauthorized,
            API_ERRORS.forbidden,
            API_ERRORS.notFound,
            API_ERRORS.conflict
        ]
    },
    {
        id: 'organizers.get',
        method: 'GET',
        path: '/v1/organizers/:slug',
        summary: 'Read a public organiser profile',
        description: 'The page an organiser is judged by: who they are, what they have on sale, what they have run before, and their refund policy. The verified badge is derived from the verification state server-side rather than from the denormalised column, so a stale badge cannot be served. A suspended organisation is not found here at all.',
        tags: [
            'organizers'
        ],
        auth: 'none',
        params: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$verification$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["organizerSlugParamSchema"],
        query: null,
        body: null,
        response: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$verification$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["publicOrganizerResponseSchema"],
        successStatus: 200,
        errors: [
            API_ERRORS.notFound
        ]
    },
    {
        id: 'events.list',
        method: 'GET',
        path: '/v1/events',
        summary: 'List events',
        description: 'Paginated, filterable event discovery. Anonymous callers only ever see PUBLISHED events; a token widens the result set to drafts the caller may view.',
        tags: [
            'events'
        ],
        auth: 'optional',
        params: null,
        query: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$requests$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["listEventsQuerySchema"],
        body: null,
        response: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$responses$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["eventListResponseSchema"],
        successStatus: 200,
        errors: [
            API_ERRORS.validation
        ]
    },
    {
        id: 'events.facets',
        method: 'GET',
        path: '/v1/events/facets',
        summary: 'Filter facets for the catalogue',
        description: 'Counts for every filterable dimension, computed over the complete eligible set — all PUBLISHED events — rather than over the page currently being displayed. Pagination changes which rows a visitor sees, never which options exist: a city whose events all fall beyond page one must still be selectable, or the filters silently hide part of the catalogue. Aggregated in the database; no table is loaded into application memory.',
        tags: [
            'events'
        ],
        auth: 'none',
        params: null,
        query: null,
        body: null,
        response: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$responses$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["eventFacetsResponseSchema"],
        successStatus: 200,
        errors: []
    },
    {
        id: 'events.get',
        method: 'GET',
        path: '/v1/events/:slug',
        summary: 'Get an event by slug',
        description: 'Full event detail including venue, organisation and ticket types. A draft event answers 404 unless the caller holds `event:view_draft` for its organisation.',
        tags: [
            'events'
        ],
        auth: 'optional',
        params: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$requests$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["slugParamSchema"],
        query: null,
        body: null,
        response: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$responses$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["eventDetailResponseSchema"],
        successStatus: 200,
        errors: [
            API_ERRORS.validation,
            API_ERRORS.notFound
        ]
    },
    {
        id: 'events.create',
        method: 'POST',
        path: '/v1/events',
        summary: 'Create an event',
        description: 'Creates an event in DRAFT status. Requires `event:create` for the target organisation. The slug must be unique across the platform.',
        tags: [
            'events'
        ],
        auth: 'session',
        params: null,
        query: null,
        body: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$requests$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["createEventRequestSchema"],
        response: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$responses$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["eventDetailResponseSchema"],
        successStatus: 201,
        errors: [
            API_ERRORS.validation,
            API_ERRORS.unauthorized,
            API_ERRORS.forbidden,
            API_ERRORS.conflict
        ]
    },
    {
        id: 'events.update',
        method: 'PATCH',
        path: '/v1/events/:id',
        summary: 'Update an event',
        description: 'Partial update; at least one field must be supplied. The owning organisation is immutable, and `status` cannot be changed here — use `POST /v1/events/:id/publish`, which requires `event:publish`. Requires `event:update`.',
        tags: [
            'events'
        ],
        auth: 'session',
        params: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$requests$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["idParamSchema"],
        query: null,
        body: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$requests$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["updateEventRequestSchema"],
        response: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$responses$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["eventDetailResponseSchema"],
        successStatus: 200,
        errors: [
            API_ERRORS.validation,
            API_ERRORS.unauthorized,
            API_ERRORS.forbidden,
            API_ERRORS.notFound,
            API_ERRORS.conflict
        ]
    },
    {
        id: 'events.publish',
        method: 'POST',
        path: '/v1/events/:id/publish',
        summary: 'Change publication status',
        description: 'Moves an event between DRAFT, PUBLISHED, CANCELLED and COMPLETED. Publishing an event with no on-sale ticket type answers 422. Requires `event:publish`.',
        tags: [
            'events'
        ],
        auth: 'session',
        params: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$requests$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["idParamSchema"],
        query: null,
        body: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$requests$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["publishEventRequestSchema"],
        response: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$responses$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["eventDetailResponseSchema"],
        successStatus: 200,
        errors: [
            API_ERRORS.validation,
            API_ERRORS.unauthorized,
            API_ERRORS.forbidden,
            API_ERRORS.notFound,
            API_ERRORS.conflict,
            API_ERRORS.unprocessable
        ]
    },
    {
        id: 'ticketTypes.listForEvent',
        method: 'GET',
        path: '/v1/events/:eventId/ticket-types',
        summary: 'List an event’s ticket types',
        description: 'Ticket tiers with live availability folded in. `availableQuantity` already subtracts active holds, so it can fall below `quantityTotal - quantitySold`.',
        tags: [
            'ticket-types'
        ],
        auth: 'optional',
        params: eventIdParamSchema,
        query: null,
        body: null,
        response: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$responses$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["ticketTypeListResponseSchema"],
        successStatus: 200,
        errors: [
            API_ERRORS.validation,
            API_ERRORS.notFound
        ]
    },
    {
        id: 'ticketTypes.create',
        method: 'POST',
        path: '/v1/events/:eventId/ticket-types',
        summary: 'Create a ticket type',
        description: 'Adds a tier to an event. Prices are integer minor units (cents/paise). Requires `ticketType:manage`.',
        tags: [
            'ticket-types'
        ],
        auth: 'session',
        params: eventIdParamSchema,
        query: null,
        body: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$requests$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["createTicketTypeRequestSchema"],
        response: ticketTypeResponseSchema,
        successStatus: 201,
        errors: [
            API_ERRORS.validation,
            API_ERRORS.unauthorized,
            API_ERRORS.forbidden,
            API_ERRORS.notFound,
            API_ERRORS.conflict
        ]
    },
    {
        id: 'holds.create',
        method: 'POST',
        path: '/v1/holds',
        summary: 'Hold inventory',
        description: 'Reserves seats for a few minutes while the buyer completes checkout. The reservation is released automatically at `expiresAt`, so clients must be ready for a later order to still fail.',
        tags: [
            'holds'
        ],
        auth: 'optional',
        params: null,
        query: null,
        body: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$requests$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["createHoldRequestSchema"],
        response: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$responses$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["holdResponseSchema"],
        successStatus: 201,
        errors: [
            API_ERRORS.validation,
            API_ERRORS.notFound,
            API_ERRORS.conflict,
            API_ERRORS.unprocessable
        ]
    },
    {
        id: 'holds.release',
        method: 'DELETE',
        path: '/v1/holds/:id',
        summary: 'Release a hold',
        description: "Returns held inventory to the pool. Ownership is verified on the server: an authenticated caller must own the hold, an anonymous one must present the one-time token from `X-Hold-Token` that was returned when the hold was taken, and releasing somebody else's hold requires the `hold:release_any` capability. A hold that does not exist and one the caller may not release both answer 404, so the endpoint cannot be used to discover hold ids. Idempotent for a hold that has already expired or been released; only a hold already converted into a paid order answers 409.",
        tags: [
            'holds'
        ],
        auth: 'optional',
        params: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$requests$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["idParamSchema"],
        query: null,
        body: null,
        response: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$responses$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["okResponseSchema"],
        successStatus: 200,
        errors: [
            API_ERRORS.validation,
            API_ERRORS.notFound,
            API_ERRORS.conflict,
            API_ERRORS.gone
        ]
    },
    {
        id: 'sessions.seats',
        method: 'GET',
        path: '/v1/sessions/:id/seats',
        summary: 'Seat map for a session',
        description: 'Every seat on sale at this session, grouped into sections and rows in the order somebody reading a ticket expects. A seat carries whether it is available and never why it is not: "held by another buyer" teaches a buyer to refresh, and "blocked" says something about the production. Accessibility attributes are published to everybody, because somebody who needs an accessible seat has to be able to find one; they describe the seat and never the person in it. A caller who may see drafts for this organisation additionally gets each seat\'s real status.',
        tags: [
            'sessions'
        ],
        auth: 'optional',
        capability: null,
        params: sessionIdParamSchema,
        query: null,
        body: null,
        response: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$seating$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["seatMapResponseSchema"],
        successStatus: 200,
        errors: [
            API_ERRORS.notFound
        ]
    },
    {
        id: 'sessions.hold',
        method: 'POST',
        path: '/v1/sessions/:id/holds',
        summary: 'Reserve seats',
        description: 'Take a set of seats for a bounded time. The request names seats and nothing else: the price, the ticket type, the hold duration and whether the buyer may have these seats are all decided server-side. Choosing an accessible seat also takes its companion seat, and choosing a companion also takes the accessible seat — in both directions, because selling either alone strands the other. All or nothing: if somebody takes one of the seats first, none of them is reserved, and the response says which seat went. The hold is owned by the signed-in buyer, or by a one-time guest token returned once and never again.',
        tags: [
            'sessions',
            'holds'
        ],
        auth: 'optional',
        capability: null,
        params: sessionIdParamSchema,
        query: null,
        body: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$seating$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["holdSeatsRequestSchema"],
        response: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$seating$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["seatHoldResponseSchema"],
        successStatus: 201,
        errors: [
            API_ERRORS.validation,
            API_ERRORS.notFound,
            API_ERRORS.conflict,
            API_ERRORS.unprocessable,
            API_ERRORS.rateLimited
        ]
    },
    {
        id: 'orders.create',
        method: 'POST',
        path: '/v1/orders',
        summary: 'Place an order',
        description: 'Converts holds into a PENDING order and computes totals server-side. Client-supplied prices are ignored: only the ticket type id and quantity are trusted.',
        tags: [
            'orders'
        ],
        auth: 'optional',
        params: null,
        query: null,
        body: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$requests$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["createOrderRequestSchema"],
        response: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$responses$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["orderResponseSchema"],
        successStatus: 201,
        errors: [
            API_ERRORS.validation,
            API_ERRORS.notFound,
            API_ERRORS.conflict,
            API_ERRORS.gone,
            API_ERRORS.unprocessable
        ]
    },
    {
        id: 'orders.get',
        method: 'GET',
        path: '/v1/orders/:reference',
        summary: 'Get an order by reference',
        description: 'Looks an order up by its customer-facing reference (e.g. `DE-8F3K2Q`). Visible to the buyer and to organisation members holding `order:view`.',
        tags: [
            'orders'
        ],
        auth: 'session',
        params: orderReferenceParamSchema,
        query: null,
        body: null,
        response: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$responses$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["orderResponseSchema"],
        successStatus: 200,
        errors: [
            API_ERRORS.validation,
            API_ERRORS.unauthorized,
            API_ERRORS.forbidden,
            API_ERRORS.notFound
        ]
    },
    {
        id: 'orders.listMine',
        method: 'GET',
        path: '/v1/orders',
        summary: 'List my orders',
        description: 'Orders belonging to the authenticated user, newest first.',
        tags: [
            'orders'
        ],
        auth: 'session',
        params: null,
        query: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$requests$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["listQuerySchema"],
        body: null,
        response: orderListResponseSchema,
        successStatus: 200,
        errors: [
            API_ERRORS.validation,
            API_ERRORS.unauthorized
        ]
    },
    {
        id: 'payments.webhook',
        method: 'POST',
        path: '/v1/payments/webhook',
        summary: 'Payment provider callback',
        description: 'The authoritative signal that money moved. A browser redirect is not: a buyer can close the tab, replay it or forge it, so fulfilment is driven from here. Processing is idempotent on `(provider, providerEventId)` — a replayed or duplicated delivery is acknowledged and changes nothing. In production this endpoint is authenticated by the provider signature; the Phase 1 mock provider posts unsigned callbacks and real payments remain disabled.',
        tags: [
            'payments'
        ],
        auth: 'none',
        params: null,
        query: null,
        body: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$requests$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["paymentWebhookRequestSchema"],
        response: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$responses$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["okResponseSchema"],
        successStatus: 200,
        errors: [
            API_ERRORS.validation,
            API_ERRORS.notFound
        ]
    },
    {
        id: 'webhooks.stripe',
        method: 'POST',
        path: '/v1/webhooks/stripe',
        summary: 'Stripe account webhook',
        description: 'Receives platform-account events. The body is read as raw bytes and the `Stripe-Signature` header is verified against them before anything else happens — a parsed body is a body whose bytes are gone, and the signature is over the bytes. A verified delivery is stored durably and acknowledged; the work happens afterwards from the stored row, so that a provider retry cannot repeat a side effect. A duplicate delivery answers 2xx without storing a second row, because the unique index on (provider, account context, event id) is what makes replay a no-op. Every refusal answers a bare 400: which part of a forgery was wrong goes to the log only. There is no mode that skips verification, and a deployment with no Stripe credentials refuses every delivery rather than accepting unsigned ones.',
        tags: [
            'webhooks'
        ],
        auth: 'none',
        capability: null,
        params: null,
        query: null,
        body: null,
        response: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$payments$2d$wire$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["webhookAckResponseSchema"],
        successStatus: 200,
        errors: [
            API_ERRORS.validation,
            API_ERRORS.rateLimited
        ]
    },
    {
        id: 'webhooks.stripeConnect',
        method: 'POST',
        path: '/v1/webhooks/stripe/connect',
        summary: 'Stripe Connect webhook',
        description: "Receives connected-account events, verified against the Connect endpoint's own signing secret. A separate endpoint with a separate secret on purpose: a Connect event names an account, and verifying it with the platform secret would let a platform event impersonate one. The same event id arriving for two different accounts is two facts, not a duplicate.",
        tags: [
            'webhooks'
        ],
        auth: 'none',
        capability: null,
        params: null,
        query: null,
        body: null,
        response: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$payments$2d$wire$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["webhookAckResponseSchema"],
        successStatus: 200,
        errors: [
            API_ERRORS.validation,
            API_ERRORS.rateLimited
        ]
    },
    {
        id: 'tickets.checkIn',
        method: 'POST',
        path: '/v1/tickets/check-in',
        summary: 'Check a ticket in',
        description: 'Scans a ticket at the door. Re-scanning an already-admitted ticket answers 200 with `alreadyCheckedIn: true` rather than an error, so a flaky scanner never blocks the queue. Requires `ticket:check_in`.',
        tags: [
            'tickets'
        ],
        auth: 'session',
        params: null,
        query: null,
        body: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$requests$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["checkInRequestSchema"],
        response: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$responses$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["checkInResponseSchema"],
        successStatus: 200,
        errors: [
            API_ERRORS.validation,
            API_ERRORS.unauthorized,
            API_ERRORS.forbidden,
            API_ERRORS.notFound,
            API_ERRORS.conflict
        ]
    },
    {
        id: 'waitlist.join',
        method: 'POST',
        path: '/v1/events/:eventId/waitlist',
        summary: 'Join the waitlist',
        description: 'Registers interest in a sold-out event. The `eventId` in the path wins over any value in the body. Joining twice with the same email returns the existing entry rather than creating a duplicate.',
        tags: [
            'waitlist'
        ],
        auth: 'optional',
        params: eventIdParamSchema,
        query: null,
        body: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$requests$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["joinWaitlistRequestSchema"],
        response: waitlistResponseSchema,
        successStatus: 201,
        errors: [
            API_ERRORS.validation,
            API_ERRORS.notFound,
            API_ERRORS.conflict
        ]
    }
].map((route)=>Object.freeze({
        ...route,
        tags: Object.freeze([
            ...route.tags
        ]),
        errors: Object.freeze([
            ...route.errors
        ])
    })));
const apiErrorResponseSchema = __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$responses$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["errorResponseSchema"];
/** Route descriptors keyed by id, built once so lookup stays O(1). */ const ROUTES_BY_ID = new Map(apiRoutes.map((route)=>[
        route.id,
        route
    ]));
const routeIds = Object.freeze(apiRoutes.map((route)=>route.id));
function routeById(id) {
    const route = ROUTES_BY_ID.get(id);
    if (!route) {
        throw new __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$api$2d$contract$2f$src$2f$errors$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["ApiContractError"](`Unknown route id "${id}"`, {
            code: 'UNKNOWN_ROUTE',
            details: {
                id,
                known: routeIds
            }
        });
    }
    return route;
}
function findRoute(id) {
    return ROUTES_BY_ID.get(id);
}
function routesByTag(tag) {
    return apiRoutes.filter((route)=>route.tags.includes(tag));
}
function routeKey(route) {
    return `${route.method} ${route.path}`;
}
function routeParamNames(route) {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$api$2d$contract$2f$src$2f$path$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["pathParamNames"])(route.path);
}
}),
"[project]/packages/pricing/src/currencies.js [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "BASE_CURRENCY",
    ()=>BASE_CURRENCY,
    "FALLBACK_FLAT_FEE_CENTS",
    ()=>FALLBACK_FLAT_FEE_CENTS,
    "FLAT_FEE_CENTS_BY_CURRENCY",
    ()=>FLAT_FEE_CENTS_BY_CURRENCY,
    "TAX_RATE_BPS_BY_CURRENCY",
    ()=>TAX_RATE_BPS_BY_CURRENCY,
    "feeConfigForCurrency",
    ()=>feeConfigForCurrency,
    "taxRateBpsForCurrency",
    ()=>taxRateBpsForCurrency
]);
/**
 * Currency-dependent commercial terms.
 *
 * These tables are the single source of truth for what a buyer is charged on
 * top of the ticket face value. They live here, in the shared package, for one
 * specific reason: the checkout page quotes a total before the order exists,
 * and the API computes the total it actually charges. When those two read from
 * different tables they disagree, and the buyer is shown one number and billed
 * another. Keeping both on these functions makes that class of bug structural
 * rather than a thing to remember.
 *
 * @module @desi-event/pricing/currencies
 */ var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$fees$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/pricing/src/fees.js [app-rsc] (ecmascript)");
;
const BASE_CURRENCY = 'INR';
const FLAT_FEE_CENTS_BY_CURRENCY = Object.freeze({
    INR: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$fees$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["DEFAULT_FEE_CONFIG"].flatCents,
    CAD: 99,
    GBP: 79,
    USD: 99,
    AUD: 99,
    AED: 300
});
const TAX_RATE_BPS_BY_CURRENCY = Object.freeze({
    INR: 1800,
    CAD: 1300,
    GBP: 2000,
    USD: 0,
    AUD: 1000,
    AED: 500
});
const FALLBACK_FLAT_FEE_CENTS = 99;
/**
 * Normalise a currency code to the form these tables are keyed by.
 *
 * @param {string} [currency] ISO 4217 code, in any case.
 * @returns {string} The upper-cased code, defaulting to the base currency.
 */ function normaliseCurrency(currency) {
    return String(currency || BASE_CURRENCY).toUpperCase();
}
function feeConfigForCurrency(currency = BASE_CURRENCY, overrides = {}) {
    const code = normaliseCurrency(currency);
    const usesOverride = code === BASE_CURRENCY && Number.isInteger(overrides.flatCents);
    return {
        percentageBps: overrides.percentageBps ?? __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$fees$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["DEFAULT_FEE_CONFIG"].percentageBps,
        flatCents: usesOverride ? overrides.flatCents : FLAT_FEE_CENTS_BY_CURRENCY[code] ?? FALLBACK_FLAT_FEE_CENTS,
        currency: code
    };
}
function taxRateBpsForCurrency(currency = BASE_CURRENCY) {
    return TAX_RATE_BPS_BY_CURRENCY[normaliseCurrency(currency)] ?? 0;
}
}),
"[project]/packages/pricing/src/discount.js [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "PROMO_REJECTION_REASONS",
    ()=>PROMO_REJECTION_REASONS,
    "PROMO_TYPES",
    ()=>PROMO_TYPES,
    "computeDiscount",
    ()=>computeDiscount,
    "evaluatePromoCode",
    ()=>evaluatePromoCode,
    "normalisePromoCode",
    ()=>normalisePromoCode,
    "toDate",
    ()=>toDate
]);
/**
 * Promo code evaluation and discount calculation.
 *
 * `PromoCode.value` follows the database convention: basis points for
 * `PERCENTAGE` (1000 = 10 %) and minor units for `FIXED_AMOUNT`.
 *
 * Validity is always evaluated against an injected `now`. Nothing in this module
 * reads the clock, so a test can pin any instant and the API can evaluate a
 * promo against the same timestamp it stamps on the order.
 *
 * @module @desi-event/pricing/discount
 */ var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$errors$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/pricing/src/errors.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$money$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/pricing/src/money.js [app-rsc] (ecmascript)");
;
;
const PROMO_TYPES = Object.freeze({
    PERCENTAGE: 'PERCENTAGE',
    FIXED_AMOUNT: 'FIXED_AMOUNT'
});
const PROMO_REJECTION_REASONS = Object.freeze({
    INACTIVE: 'INACTIVE',
    NOT_STARTED: 'NOT_STARTED',
    EXPIRED: 'EXPIRED',
    EXHAUSTED: 'EXHAUSTED',
    /** A FIXED_AMOUNT promo denominated in a different currency than the order. */ CURRENCY_MISMATCH: 'CURRENCY_MISMATCH',
    /** A FIXED_AMOUNT promo with no currency recorded at all. */ CURRENCY_MISSING: 'CURRENCY_MISSING'
});
function toDate(value, label) {
    const date = value instanceof Date ? value : typeof value === 'string' || typeof value === 'number' ? new Date(value) : null;
    if (date === null || Number.isNaN(date.getTime())) {
        throw new __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$errors$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["PricingError"](`${label} must be a Date, ISO 8601 string or epoch milliseconds`, {
            code: 'INVALID_DATE',
            details: {
                field: label,
                value
            }
        });
    }
    return date;
}
function normalisePromoCode(promoCode) {
    if (promoCode === null || typeof promoCode !== 'object') {
        throw new __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$errors$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["PricingError"]('promoCode must be an object', {
            code: 'INVALID_PROMO_CODE',
            details: {
                value: promoCode
            }
        });
    }
    const { type, value } = promoCode;
    if (type !== PROMO_TYPES.PERCENTAGE && type !== PROMO_TYPES.FIXED_AMOUNT) {
        throw new __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$errors$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["PricingError"](`promoCode.type must be PERCENTAGE or FIXED_AMOUNT, received ${JSON.stringify(type)}`, {
            code: 'INVALID_PROMO_CODE',
            details: {
                field: 'type',
                value: type
            }
        });
    }
    // Both variants are non-negative integers; the unit differs, not the shape.
    const amount = (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$money$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["assertInteger"])(value, 'promoCode.value', 'INVALID_PROMO_CODE');
    if (amount < 0) {
        throw new __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$errors$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["PricingError"](`promoCode.value must not be negative, received ${amount}`, {
            code: 'INVALID_PROMO_CODE',
            details: {
                field: 'value',
                value: amount
            }
        });
    }
    const redemptionCount = promoCode.redemptionCount ?? 0;
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$money$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["assertInteger"])(redemptionCount, 'promoCode.redemptionCount', 'INVALID_PROMO_CODE');
    if (redemptionCount < 0) {
        throw new __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$errors$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["PricingError"]('promoCode.redemptionCount must not be negative', {
            code: 'INVALID_PROMO_CODE',
            details: {
                field: 'redemptionCount',
                value: redemptionCount
            }
        });
    }
    const maxRedemptions = promoCode.maxRedemptions ?? null;
    if (maxRedemptions !== null) {
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$money$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["assertInteger"])(maxRedemptions, 'promoCode.maxRedemptions', 'INVALID_PROMO_CODE');
        if (maxRedemptions < 0) {
            throw new __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$errors$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["PricingError"]('promoCode.maxRedemptions must not be negative', {
                code: 'INVALID_PROMO_CODE',
                details: {
                    field: 'maxRedemptions',
                    value: maxRedemptions
                }
            });
        }
    }
    return {
        type,
        value: amount,
        // Upper-cased so a mismatch is decided on the code, not on its casing.
        currency: promoCode.currency ? String(promoCode.currency).toUpperCase() : null,
        active: promoCode.active ?? true,
        startsAt: promoCode.startsAt == null ? null : toDate(promoCode.startsAt, 'promoCode.startsAt'),
        endsAt: promoCode.endsAt == null ? null : toDate(promoCode.endsAt, 'promoCode.endsAt'),
        maxRedemptions,
        redemptionCount
    };
}
function evaluatePromoCode({ promoCode, now, currency = null }) {
    const promo = normalisePromoCode(promoCode);
    const at = toDate(now, 'now');
    // A flat discount is denominated: "500 off" only means anything alongside a
    // currency. Applying a ₹500 campaign to a CAD order at face value would hand
    // out roughly a hundred times the intended discount, so a mismatch makes the
    // promo inapplicable rather than being silently converted. There is no
    // exchange-rate policy here, and inventing one would be worse than refusing.
    if (promo.type === PROMO_TYPES.FIXED_AMOUNT) {
        if (!promo.currency) {
            return {
                applicable: false,
                reason: PROMO_REJECTION_REASONS.CURRENCY_MISSING
            };
        }
        if (currency && promo.currency !== String(currency).toUpperCase()) {
            return {
                applicable: false,
                reason: PROMO_REJECTION_REASONS.CURRENCY_MISMATCH
            };
        }
    }
    if (!promo.active) {
        return {
            applicable: false,
            reason: PROMO_REJECTION_REASONS.INACTIVE
        };
    }
    if (promo.startsAt !== null && at.getTime() < promo.startsAt.getTime()) {
        return {
            applicable: false,
            reason: PROMO_REJECTION_REASONS.NOT_STARTED
        };
    }
    if (promo.endsAt !== null && at.getTime() >= promo.endsAt.getTime()) {
        return {
            applicable: false,
            reason: PROMO_REJECTION_REASONS.EXPIRED
        };
    }
    if (promo.maxRedemptions !== null && promo.redemptionCount >= promo.maxRedemptions) {
        return {
            applicable: false,
            reason: PROMO_REJECTION_REASONS.EXHAUSTED
        };
    }
    return {
        applicable: true,
        reason: null
    };
}
function computeDiscount({ subtotalCents, promoCode = null, now, currency = null }) {
    const subtotal = (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$money$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["assertCents"])(subtotalCents, 'subtotalCents');
    if (promoCode == null) return 0;
    const evaluation = evaluatePromoCode({
        promoCode,
        now,
        currency
    });
    if (!evaluation.applicable) return 0;
    const promo = normalisePromoCode(promoCode);
    const raw = promo.type === PROMO_TYPES.PERCENTAGE ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$money$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["applyBps"])(subtotal, Math.min(promo.value, 10_000)) : promo.value;
    return Math.min(raw, subtotal);
}
}),
"[project]/packages/pricing/src/errors.js [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/**
 * Error type for the pricing engine.
 *
 * Every rejection carries a machine-readable `code` so that the API layer can
 * map a failure onto a stable error payload without string matching, and a
 * `statusCode` because a pricing rejection is always caused by the request
 * rather than by the server.
 *
 * @module @desi-event/pricing/errors
 */ /**
 * Raised when a pricing input is structurally invalid — a non-integer amount, a
 * negative quantity, an unusable promo code record, a currency mismatch.
 *
 * A promo code that is merely expired, inactive or exhausted is *not* an error:
 * it is an ordinary business state and yields a zero discount instead.
 */ __turbopack_context__.s([
    "PricingError",
    ()=>PricingError,
    "default",
    ()=>__TURBOPACK__default__export__
]);
class PricingError extends Error {
    /**
   * @param {string} message Human-readable description of the failure.
   * @param {object} [options] Extra detail.
   * @param {string} [options.code] Machine-readable error code. Defaults to `PRICING_ERROR`.
   * @param {number} [options.statusCode] HTTP status to surface. Defaults to `422`.
   * @param {unknown} [options.details] Arbitrary context (offending value, index, ...).
   * @param {unknown} [options.cause] Underlying error, if any.
   */ constructor(message, options = {}){
        super(message, options.cause === undefined ? undefined : {
            cause: options.cause
        });
        this.name = 'PricingError';
        this.code = options.code ?? 'PRICING_ERROR';
        this.statusCode = options.statusCode ?? 422;
        this.details = options.details;
        // Keeps the constructor frame out of stacks on V8 without affecting others.
        if (Error.captureStackTrace) Error.captureStackTrace(this, PricingError);
    }
}
const __TURBOPACK__default__export__ = PricingError;
}),
"[project]/packages/pricing/src/fees.js [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "DEFAULT_FEE_CONFIG",
    ()=>DEFAULT_FEE_CONFIG,
    "computePlatformFee",
    ()=>computePlatformFee,
    "normaliseFeeConfig",
    ()=>normaliseFeeConfig
]);
/**
 * Platform fee calculation.
 *
 * A fee has two components: a percentage of the amount being charged and a flat
 * amount per ticket. Both are integers; the percentage is expressed in basis
 * points so that "2.5 %" is the exact integer 250 rather than the inexact float
 * 0.025.
 *
 * @module @desi-event/pricing/fees
 */ var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$errors$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/pricing/src/errors.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$money$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/pricing/src/money.js [app-rsc] (ecmascript)");
;
;
const DEFAULT_FEE_CONFIG = Object.freeze({
    percentageBps: 250,
    flatCents: 500,
    currency: 'INR'
});
function normaliseFeeConfig(feeConfig = DEFAULT_FEE_CONFIG) {
    if (feeConfig === null || typeof feeConfig !== 'object') {
        throw new __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$errors$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["PricingError"]('feeConfig must be an object', {
            code: 'INVALID_FEE_CONFIG',
            details: {
                value: feeConfig
            }
        });
    }
    return {
        percentageBps: (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$money$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["assertBps"])(feeConfig.percentageBps, 'feeConfig.percentageBps'),
        flatCents: (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$money$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["assertCents"])(feeConfig.flatCents, 'feeConfig.flatCents'),
        currency: (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$money$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["normaliseCurrency"])(feeConfig.currency, 'feeConfig.currency')
    };
}
function computePlatformFee({ subtotalCents, quantity = 1, feeConfig = DEFAULT_FEE_CONFIG }) {
    const amount = (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$money$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["assertCents"])(subtotalCents, 'subtotalCents');
    const tickets = (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$money$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["assertQuantity"])(quantity, 'quantity');
    const config = normaliseFeeConfig(feeConfig);
    if (amount === 0) return 0;
    const percentageComponent = (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$money$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["applyBps"])(amount, config.percentageBps);
    const flatComponent = (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$money$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["assertCents"])(config.flatCents * tickets, 'feeConfig.flatCents * quantity');
    return percentageComponent + flatComponent;
}
}),
"[project]/packages/pricing/src/index.js [app-rsc] (ecmascript) <locals>", ((__turbopack_context__) => {
"use strict";

/**
 * `@desi-event/pricing` — the money engine.
 *
 * Every amount crossing this package's boundary is an integer number of minor
 * units ("cents"; paise for INR). There is no floating point arithmetic
 * anywhere: percentages are basis points, divisions are exact integer divisions
 * with an explicit half-up remainder test, and even `formatMoney` builds a
 * decimal string instead of dividing by 100.
 *
 * The canonical order of operations for an order is documented in `totals.js`:
 * subtotal → discount → fees on the discounted subtotal → tax → total.
 *
 * @module @desi-event/pricing
 */ __turbopack_context__.s([]);
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$money$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/pricing/src/money.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$fees$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/pricing/src/fees.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$currencies$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/pricing/src/currencies.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$discount$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/pricing/src/discount.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$totals$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/pricing/src/totals.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$tax$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/pricing/src/tax.js [app-rsc] (ecmascript)");
;
;
;
;
;
;
;
}),
"[project]/packages/pricing/src/money.js [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "BPS_DENOMINATOR",
    ()=>BPS_DENOMINATOR,
    "MAX_BPS",
    ()=>MAX_BPS,
    "MAX_CENTS",
    ()=>MAX_CENTS,
    "applyBps",
    ()=>applyBps,
    "assertBps",
    ()=>assertBps,
    "assertCents",
    ()=>assertCents,
    "assertInteger",
    ()=>assertInteger,
    "assertQuantity",
    ()=>assertQuantity,
    "divideRoundHalfUp",
    ()=>divideRoundHalfUp,
    "floorDivide",
    ()=>floorDivide,
    "formatMoney",
    ()=>formatMoney,
    "multiplyExact",
    ()=>multiplyExact,
    "normaliseCurrency",
    ()=>normaliseCurrency
]);
/**
 * Integer-cent arithmetic primitives shared by the whole pricing engine.
 *
 * ## Rounding rule (applies everywhere in this package)
 *
 * Every division rounds **half up**: the exact quotient is taken when it is an
 * integer, otherwise the result is the nearest integer and an exact tie (`.5`)
 * goes towards positive infinity. Because every arithmetic input is validated
 * as non-negative, half up is indistinguishable from half away from zero here;
 * the implementation still handles negatives correctly so the helper can be
 * reused for refund deltas. One rule, applied to percentage fees, percentage
 * discounts and tax alike, is what keeps `subtotal - discount + fees + tax`
 * reconciling exactly with the stored order columns.
 *
 * All values are integers. No floating point value ever reaches an output: the
 * only division is exact integer division with an explicit remainder test, and
 * `formatMoney` renders a decimal string rather than dividing by 100.
 *
 * @module @desi-event/pricing/money
 */ var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$errors$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/pricing/src/errors.js [app-rsc] (ecmascript)");
;
const BPS_DENOMINATOR = 10_000;
const MAX_CENTS = 2_147_483_647;
const MAX_BPS = 1_000_000;
/** Well-formed ISO 4217 alphabetic currency code. */ const CURRENCY_PATTERN = /^[A-Z]{3}$/;
function floorDivide(numerator, denominator) {
    let quotient = Math.floor(numerator / denominator);
    let remainder = numerator - quotient * denominator;
    while(remainder < 0){
        quotient -= 1;
        remainder += denominator;
    }
    while(remainder >= denominator){
        quotient += 1;
        remainder -= denominator;
    }
    return {
        quotient,
        remainder
    };
}
function assertInteger(value, label, code = 'INVALID_AMOUNT') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$errors$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["PricingError"](`${label} must be a number, received ${describe(value)}`, {
            code,
            details: {
                field: label,
                value
            }
        });
    }
    if (!Number.isInteger(value)) {
        throw new __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$errors$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["PricingError"](`${label} must be an integer number of minor units (cents), received ${value}`, {
            code,
            details: {
                field: label,
                value
            }
        });
    }
    if (!Number.isSafeInteger(value)) {
        throw new __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$errors$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["PricingError"](`${label} exceeds the safe integer range`, {
            code: 'AMOUNT_OUT_OF_RANGE',
            details: {
                field: label,
                value
            }
        });
    }
    return value;
}
function assertCents(value, label) {
    const cents = assertInteger(value, label, 'INVALID_AMOUNT');
    if (cents < 0) {
        throw new __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$errors$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["PricingError"](`${label} must not be negative, received ${cents}`, {
            code: 'NEGATIVE_AMOUNT',
            details: {
                field: label,
                value: cents
            }
        });
    }
    if (cents > MAX_CENTS) {
        throw new __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$errors$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["PricingError"](`${label} exceeds the maximum supported amount (${MAX_CENTS})`, {
            code: 'AMOUNT_OUT_OF_RANGE',
            details: {
                field: label,
                value: cents,
                max: MAX_CENTS
            }
        });
    }
    return cents;
}
function assertQuantity(value, label) {
    const quantity = assertInteger(value, label, 'INVALID_QUANTITY');
    if (quantity < 0) {
        throw new __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$errors$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["PricingError"](`${label} must not be negative, received ${quantity}`, {
            code: 'INVALID_QUANTITY',
            details: {
                field: label,
                value: quantity
            }
        });
    }
    return quantity;
}
function assertBps(value, label) {
    const bps = assertInteger(value, label, 'INVALID_BPS');
    if (bps < 0 || bps > MAX_BPS) {
        throw new __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$errors$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["PricingError"](`${label} must be between 0 and ${MAX_BPS} basis points, received ${bps}`, {
            code: 'INVALID_BPS',
            details: {
                field: label,
                value: bps,
                max: MAX_BPS
            }
        });
    }
    return bps;
}
function normaliseCurrency(currency, label = 'currency') {
    if (typeof currency !== 'string' || !CURRENCY_PATTERN.test(currency.toUpperCase())) {
        throw new __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$errors$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["PricingError"](`${label} must be a three-letter ISO 4217 code, received ${describe(currency)}`, {
            code: 'INVALID_CURRENCY',
            details: {
                field: label,
                value: currency
            }
        });
    }
    return currency.toUpperCase();
}
function divideRoundHalfUp(numerator, denominator) {
    assertInteger(numerator, 'numerator');
    assertInteger(denominator, 'denominator');
    if (denominator === 0) {
        throw new __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$errors$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["PricingError"]('Cannot divide by zero', {
            code: 'INVALID_DENOMINATOR'
        });
    }
    // Move the sign onto the numerator so that "half up" always means the same
    // direction regardless of how the caller signed the denominator.
    const n = denominator < 0 ? -numerator : numerator;
    const d = Math.abs(denominator);
    const { quotient, remainder } = floorDivide(n, d);
    return remainder * 2 >= d ? quotient + 1 : quotient;
}
function multiplyExact(a, b, label = 'amount') {
    const product = a * b;
    if (!Number.isSafeInteger(product)) {
        throw new __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$errors$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["PricingError"](`${label} overflows the safe integer range`, {
            code: 'AMOUNT_OUT_OF_RANGE',
            details: {
                field: label,
                a,
                b
            }
        });
    }
    return product;
}
function applyBps(cents, bps) {
    const amount = assertCents(cents, 'cents');
    const rate = assertBps(bps, 'bps');
    return divideRoundHalfUp(multiplyExact(amount, rate, 'cents * bps'), BPS_DENOMINATOR);
}
/**
 * Render an integer amount as a plain decimal string with the given number of
 * fraction digits, using only integer arithmetic.
 *
 * @param {number} cents Amount in minor units; may be negative.
 * @param {number} minorUnits Number of fraction digits for the currency.
 * @returns {string} A decimal string such as `-1234.05`.
 */ function toDecimalString(cents, minorUnits) {
    const sign = cents < 0 ? '-' : '';
    const absolute = Math.abs(cents);
    if (minorUnits === 0) return `${sign}${absolute}`;
    const scale = 10 ** minorUnits;
    const { quotient, remainder } = floorDivide(absolute, scale);
    return `${sign}${quotient}.${String(remainder).padStart(minorUnits, '0')}`;
}
function formatMoney(cents, currency = 'INR', locale = 'en-IN') {
    const amount = assertInteger(cents, 'cents');
    const code = normaliseCurrency(currency);
    let formatter;
    try {
        formatter = new Intl.NumberFormat(locale, {
            style: 'currency',
            currency: code
        });
    } catch (error) {
        throw new __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$errors$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["PricingError"](`Cannot format money for locale ${describe(locale)}`, {
            code: 'INVALID_LOCALE',
            details: {
                locale,
                currency: code
            },
            cause: error
        });
    }
    const { maximumFractionDigits } = formatter.resolvedOptions();
    return formatter.format(toDecimalString(amount, maximumFractionDigits));
}
/**
 * Describe an arbitrary value for an error message without throwing on symbols
 * or circular structures.
 *
 * @param {unknown} value Value to describe.
 * @returns {string} A short printable description.
 */ function describe(value) {
    if (typeof value === 'string') return JSON.stringify(value);
    if (typeof value === 'symbol') return value.toString();
    if (value === null) return 'null';
    if (typeof value === 'object') return Array.isArray(value) ? 'an array' : 'an object';
    return String(value);
}
}),
"[project]/packages/pricing/src/tax.js [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "DEMO_TAX_POLICIES",
    ()=>DEMO_TAX_POLICIES,
    "TAX_POLICY_STATUS",
    ()=>TAX_POLICY_STATUS,
    "TAX_POLICY_VERSION",
    ()=>TAX_POLICY_VERSION,
    "TAX_TREATMENT",
    ()=>TAX_TREATMENT,
    "assertTaxPolicyUsable",
    ()=>assertTaxPolicyUsable,
    "buildPricingSnapshot",
    ()=>buildPricingSnapshot,
    "resolveTaxPolicy",
    ()=>resolveTaxPolicy
]);
/**
 * Tax policy resolution.
 *
 * Two things this module refuses to do, both of which the previous
 * implementation did:
 *
 * **It does not key tax off currency.** An event priced in CAD is not
 * necessarily taxed in Ontario, and an event priced in INR is not necessarily
 * taxed in India. Tax follows the jurisdiction the supply happens in — where
 * the event is held — so that is what the lookup takes. Keying off currency
 * meant a Toronto event that happened to be priced in rupees would have had
 * Indian GST applied to it.
 *
 * **It does not pretend these rates are verified.** Every rate below is marked
 * `DEMO`. They were carried over from seed data and a checkout mock-up, not
 * from a tax determination, and nobody has confirmed the registration status,
 * the place-of-supply rules, or whether the organiser is even registered. A
 * DEMO rate is fine for a development database and a screenshot; it is not fine
 * for money that a real buyer pays and a real organiser has to remit.
 *
 * So production fails closed. {@link assertTaxPolicyUsable} throws unless the
 * policy is `CONFIGURED`, which means a deployment has supplied a real one. A
 * deployment that wants to run on demo rates has to say so explicitly.
 *
 * @module @desi-event/pricing/tax
 */ var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$errors$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/pricing/src/errors.js [app-rsc] (ecmascript)");
;
const TAX_POLICY_VERSION = '2026-09-14.demo.1';
const TAX_POLICY_STATUS = Object.freeze({
    /** Illustrative. Carried from seed data; not a tax determination. */ DEMO: 'DEMO',
    /** Supplied by the deployment and owned by whoever configured it. */ CONFIGURED: 'CONFIGURED'
});
const TAX_TREATMENT = Object.freeze({
    /** Tax is added on top of the ticket price and the fee. */ EXCLUSIVE: 'EXCLUSIVE',
    /** The displayed price already contains the tax. */ INCLUSIVE: 'INCLUSIVE'
});
const DEMO_TAX_POLICIES = Object.freeze([
    Object.freeze({
        jurisdiction: 'IN',
        country: 'IN',
        region: null,
        name: 'GST',
        rateBps: 1_800,
        treatment: TAX_TREATMENT.EXCLUSIVE,
        effectiveFrom: '2017-07-01',
        status: TAX_POLICY_STATUS.DEMO,
        note: 'Illustrative single rate. Real Indian GST on event admission depends on registration, place of supply and ticket price bands.'
    }),
    Object.freeze({
        jurisdiction: 'CA-ON',
        country: 'CA',
        region: 'ON',
        name: 'HST',
        rateBps: 1_300,
        treatment: TAX_TREATMENT.EXCLUSIVE,
        effectiveFrom: '2010-07-01',
        status: TAX_POLICY_STATUS.DEMO,
        note: 'Illustrative. Ontario HST only; other provinces differ and GST/PST splits are not modelled.'
    }),
    Object.freeze({
        jurisdiction: 'GB',
        country: 'GB',
        region: null,
        name: 'VAT',
        rateBps: 2_000,
        treatment: TAX_TREATMENT.EXCLUSIVE,
        effectiveFrom: '2011-01-04',
        status: TAX_POLICY_STATUS.DEMO,
        note: 'Illustrative standard rate. Cultural exemptions that often apply to live events are not modelled.'
    }),
    Object.freeze({
        jurisdiction: 'US',
        country: 'US',
        region: null,
        name: 'Sales tax',
        rateBps: 0,
        treatment: TAX_TREATMENT.EXCLUSIVE,
        effectiveFrom: '1970-01-01',
        status: TAX_POLICY_STATUS.DEMO,
        note: 'Deliberately zero. US sales tax on admissions varies by state, county and city, and cannot be represented as one national rate. A US deployment must configure a real determination.'
    })
]);
/** Returned when no policy covers the supply. */ const UNKNOWN_POLICY = Object.freeze({
    jurisdiction: null,
    name: null,
    rateBps: 0,
    treatment: TAX_TREATMENT.EXCLUSIVE,
    status: TAX_POLICY_STATUS.DEMO,
    version: TAX_POLICY_VERSION,
    resolved: false,
    note: 'No tax policy matched this jurisdiction.'
});
function resolveTaxPolicy({ country, region = null, at = null, policies = DEMO_TAX_POLICIES } = {}) {
    if (!country) return {
        ...UNKNOWN_POLICY
    };
    const code = String(country).toUpperCase();
    const sub = region ? String(region).toUpperCase() : null;
    const when = at === null ? null : new Date(at);
    const candidates = policies.filter((policy)=>{
        if (policy.country !== code) return false;
        if (policy.region !== null && policy.region !== sub) return false;
        if (when && policy.effectiveFrom && new Date(policy.effectiveFrom) > when) return false;
        return true;
    });
    if (candidates.length === 0) return {
        ...UNKNOWN_POLICY
    };
    // A region-specific policy beats a country-wide one.
    const match = candidates.find((policy)=>policy.region !== null) ?? candidates[0];
    return {
        jurisdiction: match.jurisdiction,
        name: match.name,
        rateBps: match.rateBps,
        treatment: match.treatment,
        status: match.status,
        version: TAX_POLICY_VERSION,
        resolved: true,
        note: match.note ?? null
    };
}
function assertTaxPolicyUsable(policy, { environment = 'development', allowDemo = false } = {}) {
    if (environment !== 'production') return policy;
    if (policy.status === TAX_POLICY_STATUS.CONFIGURED) return policy;
    if (allowDemo) return policy;
    throw new __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$errors$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["PricingError"](`Tax policy for ${policy.jurisdiction ?? 'this jurisdiction'} is ${policy.status}, not CONFIGURED. ` + 'Configure a real tax determination, or set ALLOW_DEMO_TAX_IN_PRODUCTION=true to accept illustrative rates deliberately.', {
        code: 'TAX_POLICY_NOT_CONFIGURED',
        details: {
            jurisdiction: policy.jurisdiction,
            status: policy.status,
            version: policy.version
        }
    });
}
function buildPricingSnapshot({ feeConfig, taxPolicy, currency }) {
    return {
        currency,
        feeConfig: {
            percentageBps: feeConfig.percentageBps,
            flatCents: feeConfig.flatCents,
            currency: feeConfig.currency
        },
        tax: {
            jurisdiction: taxPolicy.jurisdiction,
            name: taxPolicy.name,
            rateBps: taxPolicy.rateBps,
            treatment: taxPolicy.treatment,
            status: taxPolicy.status,
            version: taxPolicy.version,
            resolved: taxPolicy.resolved
        }
    };
}
}),
"[project]/packages/pricing/src/totals.js [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "allocateProportionally",
    ()=>allocateProportionally,
    "computeOrderTotals",
    ()=>computeOrderTotals
]);
/**
 * Order total calculation — the single place where the order of operations for
 * money is defined.
 *
 * ## Order of operations (a business decision, not an implementation detail)
 *
 * ```
 * subtotal            = Σ (quantity × unitPrice)          per ticket type
 * discount            = promo applied to the subtotal, clamped to [0, subtotal]
 * discountedSubtotal  = subtotal − discount
 * fees                = platform fee on the DISCOUNTED subtotal
 * tax                 = taxRateBps applied to (discountedSubtotal + fees)
 * total               = discountedSubtotal + fees + tax
 * ```
 *
 * Three choices are deliberate:
 *
 * 1. **Fees are charged on the discounted subtotal.** The organiser's promo is a
 *    genuine price reduction, so the platform takes its percentage of what the
 *    buyer actually pays rather than of the pre-discount list price.
 * 2. **Tax is charged on the fee as well as on the tickets.** Indian GST applies
 *    to the service fee, so the taxable base is `discountedSubtotal + fees`.
 * 3. **The discount is clamped to the subtotal.** A 100 % (or oversized) promo
 *    makes the tickets free; it never turns fees or tax negative, and it never
 *    produces a negative total.
 *
 * Every step rounds half up and every value stays an integer number of minor
 * units, so `subtotalCents − discountCents + feesCents + taxCents === totalCents`
 * holds exactly, and `Σ lineItems[].subtotalCents === subtotalCents` holds
 * exactly as well.
 *
 * @module @desi-event/pricing/totals
 */ var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$errors$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/pricing/src/errors.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$discount$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/pricing/src/discount.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$fees$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/pricing/src/fees.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$money$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/pricing/src/money.js [app-rsc] (ecmascript)");
;
;
;
;
function allocateProportionally(totalCents, weights) {
    const total = (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$money$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["assertCents"])(totalCents, 'totalCents');
    if (!Array.isArray(weights)) {
        throw new __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$errors$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["PricingError"]('weights must be an array', {
            code: 'INVALID_ALLOCATION'
        });
    }
    const safeWeights = weights.map((weight, index)=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$money$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["assertCents"])(weight, `weights[${index}]`));
    const weightSum = safeWeights.reduce((sum, weight)=>sum + weight, 0);
    if (total === 0) return safeWeights.map(()=>0);
    // Allocating a non-zero amount across buckets that carry no weight has no
    // defined answer, and returning zeros would silently discard money: a
    // discount would vanish from the breakdown while still reducing the total.
    // Callers must not reach this state, so say so loudly rather than lose it.
    if (weightSum === 0) {
        throw new __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$errors$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["PricingError"]('cannot allocate a non-zero amount across zero total weight', {
            code: 'INVALID_ALLOCATION',
            details: {
                totalCents: total,
                weights: safeWeights
            }
        });
    }
    // The intermediate `total * weight` is computed in BigInt.
    //
    // Both operands are individually valid up to MAX_CENTS (1e12), but their
    // product reaches 1e24 — far past Number.MAX_SAFE_INTEGER. Doing this in
    // doubles put the real ceiling at about 9.4e7 minor units, so allocating a
    // ₹1,000,000 discount across a line of the same size threw
    // AMOUNT_OUT_OF_RANGE and refused a perfectly legitimate order. BigInt makes
    // the division exact at any size the surrounding guards permit; every
    // quotient is bounded by `total`, so converting back to Number is safe.
    const bigTotal = BigInt(total);
    const bigWeightSum = BigInt(weightSum);
    const shares = [];
    const remainders = [];
    let allocated = 0;
    for(let index = 0; index < safeWeights.length; index += 1){
        const numerator = bigTotal * BigInt(safeWeights[index]);
        const quotient = Number(numerator / bigWeightSum);
        const remainder = Number(numerator % bigWeightSum);
        shares.push(quotient);
        remainders.push(remainder);
        allocated += quotient;
    }
    const order = remainders.map((remainder, index)=>({
            remainder,
            index
        })).sort((a, b)=>b.remainder - a.remainder || a.index - b.index);
    let leftover = total - allocated;
    for(let position = 0; position < order.length && leftover > 0; position += 1){
        shares[order[position].index] += 1;
        leftover -= 1;
    }
    return shares;
}
/**
 * Validate a single order item and expand it into a line item.
 *
 * @param {OrderItemInput} item Raw item.
 * @param {number} index Position in the input array, used in error messages.
 * @returns {OrderLineItem} The validated line, with `discountCents` still zero.
 * @throws {PricingError} If the item is malformed.
 */ function toLineItem(item, index) {
    if (item === null || typeof item !== 'object') {
        throw new __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$errors$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["PricingError"](`items[${index}] must be an object`, {
            code: 'INVALID_ITEM',
            details: {
                index,
                value: item
            }
        });
    }
    if (typeof item.ticketTypeId !== 'string' || item.ticketTypeId.trim() === '') {
        throw new __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$errors$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["PricingError"](`items[${index}].ticketTypeId must be a non-empty string`, {
            code: 'INVALID_ITEM',
            details: {
                index,
                value: item.ticketTypeId
            }
        });
    }
    if (item.name != null && typeof item.name !== 'string') {
        throw new __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$errors$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["PricingError"](`items[${index}].name must be a string when provided`, {
            code: 'INVALID_ITEM',
            details: {
                index,
                value: item.name
            }
        });
    }
    const quantity = (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$money$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["assertQuantity"])(item.quantity, `items[${index}].quantity`);
    const unitPriceCents = (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$money$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["assertCents"])(item.unitPriceCents, `items[${index}].unitPriceCents`);
    const subtotalCents = (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$money$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["assertCents"])((0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$money$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["multiplyExact"])(quantity, unitPriceCents, `items[${index}] subtotal`), `items[${index}] subtotal`);
    return {
        ticketTypeId: item.ticketTypeId,
        name: item.name ?? null,
        quantity,
        unitPriceCents,
        subtotalCents,
        discountCents: 0
    };
}
function computeOrderTotals({ items, promoCode = null, feeConfig = __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$fees$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["DEFAULT_FEE_CONFIG"], taxRateBps = 0, currency, now }) {
    if (!Array.isArray(items)) {
        throw new __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$errors$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["PricingError"]('items must be an array', {
            code: 'INVALID_ITEMS',
            details: {
                value: items
            }
        });
    }
    const config = (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$fees$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["normaliseFeeConfig"])(feeConfig);
    const orderCurrency = currency === undefined ? config.currency : (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$money$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["normaliseCurrency"])(currency);
    // A flat fee is denominated in a specific currency, so quietly charging an INR
    // flat fee on a USD order would silently mis-price it.
    if (feeConfig !== __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$fees$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["DEFAULT_FEE_CONFIG"] && config.currency !== orderCurrency) {
        throw new __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$errors$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["PricingError"](`feeConfig.currency ${config.currency} does not match the order currency ${orderCurrency}`, {
            code: 'CURRENCY_MISMATCH',
            details: {
                feeCurrency: config.currency,
                orderCurrency
            }
        });
    }
    const taxRate = (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$money$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["assertBps"])(taxRateBps, 'taxRateBps');
    const lineItems = items.map(toLineItem);
    const subtotalCents = (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$money$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["assertCents"])(lineItems.reduce((sum, line)=>sum + line.subtotalCents, 0), 'subtotalCents');
    const quantity = lineItems.reduce((sum, line)=>sum + line.quantity, 0);
    const discountCents = (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$discount$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["computeDiscount"])({
        subtotalCents,
        promoCode,
        now,
        currency: orderCurrency
    });
    const discountedSubtotalCents = subtotalCents - discountCents;
    const feesCents = (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$fees$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["computePlatformFee"])({
        subtotalCents: discountedSubtotalCents,
        quantity,
        feeConfig: config
    });
    const taxCents = (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$pricing$2f$src$2f$money$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["applyBps"])(discountedSubtotalCents + feesCents, taxRate);
    const totalCents = discountedSubtotalCents + feesCents + taxCents;
    const allocation = allocateProportionally(discountCents, lineItems.map((line)=>line.subtotalCents));
    const pricedLines = lineItems.map((line, index)=>({
            ...line,
            discountCents: allocation[index]
        }));
    return {
        currency: orderCurrency,
        subtotalCents,
        discountCents,
        feesCents,
        taxCents,
        totalCents,
        lineItems: pricedLines
    };
}
}),
"[project]/packages/schemas/src/auth.js [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "acceptedResponseSchema",
    ()=>acceptedResponseSchema,
    "changePasswordRequestSchema",
    ()=>changePasswordRequestSchema,
    "confirmTotpRequestSchema",
    ()=>confirmTotpRequestSchema,
    "currentSessionResponseSchema",
    ()=>currentSessionResponseSchema,
    "deviceListResponseSchema",
    ()=>deviceListResponseSchema,
    "deviceSummarySchema",
    ()=>deviceSummarySchema,
    "disableMfaRequestSchema",
    ()=>disableMfaRequestSchema,
    "enrollTotpRequestSchema",
    ()=>enrollTotpRequestSchema,
    "forgotPasswordRequestSchema",
    ()=>forgotPasswordRequestSchema,
    "mfaFactorListResponseSchema",
    ()=>mfaFactorListResponseSchema,
    "mfaFactorSummarySchema",
    ()=>mfaFactorSummarySchema,
    "opaqueTokenSchema",
    ()=>opaqueTokenSchema,
    "otpCodeSchema",
    ()=>otpCodeSchema,
    "registerAccountRequestSchema",
    ()=>registerAccountRequestSchema,
    "resendVerificationRequestSchema",
    ()=>resendVerificationRequestSchema,
    "resetPasswordRequestSchema",
    ()=>resetPasswordRequestSchema,
    "revokeRequestSchema",
    ()=>revokeRequestSchema,
    "sessionListResponseSchema",
    ()=>sessionListResponseSchema,
    "sessionSummarySchema",
    ()=>sessionSummarySchema,
    "signInRequestSchema",
    ()=>signInRequestSchema,
    "signInResponseSchema",
    ()=>signInResponseSchema,
    "signOutRequestSchema",
    ()=>signOutRequestSchema,
    "stepUpRequestSchema",
    ()=>stepUpRequestSchema,
    "totpConfirmedResponseSchema",
    ()=>totpConfirmedResponseSchema,
    "totpEnrollmentResponseSchema",
    ()=>totpEnrollmentResponseSchema,
    "verifyEmailRequestSchema",
    ()=>verifyEmailRequestSchema
]);
/**
 * Request and response shapes for the Phase 2 authentication surface.
 *
 * Kept in their own module rather than added to `requests.js` and `responses.js`
 * because there are twenty of them and they belong to one feature: sessions,
 * devices, email verification, password reset, and a second factor. The rest of
 * the API's shapes are about tickets and money.
 *
 * Two conventions run through all of them, and both are about what is *absent*:
 *
 *   - **No response carries a credential except the one that issues it.** A
 *     session list describes sessions; it does not include their tokens. A
 *     device list describes devices; it does not include their fingerprints. The
 *     TOTP secret appears exactly once, in the response to the enrolment request
 *     that generated it, and never again.
 *   - **No response says whether an account exists.** Registration, sign-in,
 *     "forgot password" and "resend verification" all answer the same way for a
 *     known and an unknown address. The one exception is registration's 409 for a
 *     duplicate, which is unavoidable if the form is to be usable — and which is
 *     rate-limited for exactly that reason.
 *
 * @module @desi-event/schemas/auth
 */ var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/zod@4.6.5/node_modules/zod/v4/classic/external.js [app-rsc] (ecmascript) <export * as z>");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$enums$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/schemas/src/enums.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/schemas/src/primitives.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$entities$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/schemas/src/entities.js [app-rsc] (ecmascript)");
;
;
;
;
/**
 * A short human-supplied label, trimmed and bounded.
 *
 * `nonEmptyStringSchema` cannot be narrowed with `.max()`: it is a
 * `z.preprocess` pipe, and normalisation has to stay in the preprocess step so
 * that `z.toJSONSchema` can render these schemas for the OpenAPI document. So
 * the bound is applied where the string is, inside the pipe.
 *
 * @param {number} max Longest accepted length.
 * @returns {object} The schema.
 */ function labelSchema(max) {
    return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].preprocess((value)=>typeof value === 'string' ? value.trim() : value, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().min(1).max(max));
}
const otpCodeSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].preprocess((value)=>typeof value === 'string' ? value.replace(/[\s-]/g, '').toUpperCase() : value, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().min(6).max(24).regex(/^[0-9A-Z]+$/, 'Expected a numeric code or a recovery code')).describe('A TOTP code or a recovery code. Spaces and hyphens are ignored.');
const opaqueTokenSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().min(16).max(512).regex(/^[A-Za-z0-9_-]+$/, 'Expected a url-safe token');
const registerAccountRequestSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    email: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["emailSchema"],
    password: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["passwordSchema"],
    displayName: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["nonEmptyStringSchema"],
    phone: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["phoneSchema"].optional(),
    locale: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["localeSchema"].default('en-IN'),
    // Only these two are self-service. Every other role is granted out of band,
    // and a request naming one is refused by schema rather than by a handler
    // remembering to check.
    role: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].enum([
        'ATTENDEE',
        'ORGANIZER'
    ]).default('ATTENDEE')
});
const signInRequestSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    email: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["emailSchema"],
    password: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().min(1).max(128),
    // Supplied when the account has a second factor. Absent on the first attempt,
    // which is answered with `mfaRequired` rather than an error.
    code: otpCodeSchema.optional(),
    // A label the person gives this browser, shown in their device list.
    deviceLabel: labelSchema(120).optional()
});
const verifyEmailRequestSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    token: opaqueTokenSchema
});
const resendVerificationRequestSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    email: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["emailSchema"]
});
const forgotPasswordRequestSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    email: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["emailSchema"]
});
const resetPasswordRequestSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    token: opaqueTokenSchema,
    password: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["passwordSchema"]
});
const changePasswordRequestSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    // Required even though the caller is already authenticated: a session is
    // evidence of who they were when they signed in, not evidence that the person
    // at the keyboard now knows the password.
    currentPassword: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().min(1).max(128),
    password: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["passwordSchema"]
});
const stepUpRequestSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    password: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().min(1).max(128).optional(),
    code: otpCodeSchema.optional()
}).refine((value)=>Boolean(value.password ?? value.code), {
    message: 'Supply a password or a one-time code'
});
const enrollTotpRequestSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    label: labelSchema(120).optional()
});
const confirmTotpRequestSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    factorId: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"],
    code: otpCodeSchema
});
const disableMfaRequestSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    // Disabling a factor is a privilege change, so it is gated on knowing the
    // password rather than on holding the session that the factor protects.
    currentPassword: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().min(1).max(128)
});
const signOutRequestSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    everywhere: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].boolean().default(false)
});
const revokeRequestSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    reason: labelSchema(200).optional()
});
const sessionSummarySchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    id: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"],
    current: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].boolean().describe('True for the session making this request.'),
    createdAt: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["timestampSchema"],
    lastSeenAt: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["timestampSchema"],
    expiresAt: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["timestampSchema"],
    userAgent: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().max(400).nullish(),
    deviceId: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"].nullish(),
    deviceLabel: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().max(120).nullish(),
    mfaSatisfiedAt: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["timestampSchema"].nullish()
});
const deviceSummarySchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    id: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"],
    label: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().max(120).nullish(),
    trusted: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].boolean(),
    firstSeenAt: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["timestampSchema"],
    lastSeenAt: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["timestampSchema"],
    activeSessions: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].int().min(0)
});
const mfaFactorSummarySchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    id: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"],
    type: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$enums$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["mfaFactorTypeSchema"],
    label: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().max(120).nullish(),
    confirmed: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].boolean(),
    createdAt: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["timestampSchema"],
    lastUsedAt: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["timestampSchema"].nullish()
});
const signInResponseSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    token: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().min(1).nullish(),
    tokenType: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].literal('Bearer').default('Bearer'),
    expiresAt: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["timestampSchema"].nullish(),
    csrfToken: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().min(1).nullish(),
    user: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$entities$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["publicUserSchema"].nullish(),
    mfaRequired: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].boolean().default(false),
    emailVerificationRequired: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].boolean().default(false),
    sessionId: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"].nullish()
});
const currentSessionResponseSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    data: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
        user: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$entities$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["publicUserSchema"],
        capabilities: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].array(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().min(1)),
        memberships: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].array(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
            organizationId: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"],
            organizationName: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["nonEmptyStringSchema"].nullish(),
            role: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().min(1),
            capabilities: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].array(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().min(1))
        })),
        session: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
            id: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"],
            expiresAt: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["timestampSchema"],
            stepUpSatisfied: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].boolean(),
            mfaRequired: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].boolean(),
            mfaEnrolled: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].boolean()
        })
    })
});
const sessionListResponseSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    data: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].array(sessionSummarySchema)
});
const deviceListResponseSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    data: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].array(deviceSummarySchema)
});
const mfaFactorListResponseSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    data: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
        required: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].boolean().describe("Whether this account's roles require a second factor."),
        satisfied: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].boolean().describe('Whether a confirmed factor exists.'),
        factors: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].array(mfaFactorSummarySchema)
    })
});
const totpEnrollmentResponseSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    data: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
        factorId: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"],
        secret: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().min(16),
        uri: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().min(1),
        digits: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].int(),
        periodSeconds: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].int(),
        algorithm: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().min(1)
    })
});
const totpConfirmedResponseSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    data: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
        factorId: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"],
        recoveryCodes: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].array(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().min(8))
    })
});
const acceptedResponseSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    data: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
        accepted: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].literal(true),
        message: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["nonEmptyStringSchema"]
    })
});
}),
"[project]/packages/schemas/src/entities.js [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "auditLogSchema",
    ()=>auditLogSchema,
    "eventSchema",
    ()=>eventSchema,
    "eventSummarySchema",
    ()=>eventSummarySchema,
    "eventWithRelationsSchema",
    ()=>eventWithRelationsSchema,
    "membershipSchema",
    ()=>membershipSchema,
    "orderItemSchema",
    ()=>orderItemSchema,
    "orderSchema",
    ()=>orderSchema,
    "orderWithItemsSchema",
    ()=>orderWithItemsSchema,
    "organizationSchema",
    ()=>organizationSchema,
    "paymentSchema",
    ()=>paymentSchema,
    "promoCodeSchema",
    ()=>promoCodeSchema,
    "publicOrganizerSummarySchema",
    ()=>publicOrganizerSummarySchema,
    "publicUserSchema",
    ()=>publicUserSchema,
    "ticketHoldSchema",
    ()=>ticketHoldSchema,
    "ticketSchema",
    ()=>ticketSchema,
    "ticketTypeSchema",
    ()=>ticketTypeSchema,
    "userSchema",
    ()=>userSchema,
    "venueSchema",
    ()=>venueSchema,
    "waitlistEntrySchema",
    ()=>waitlistEntrySchema
]);
/**
 * Entity schemas mirroring the Prisma models.
 *
 * Every timestamp uses {@link timestampSchema}, so a row read straight out of
 * Prisma (with real `Date` objects) and the same row after a JSON round trip
 * both parse, and both come out as UTC ISO-8601 strings. That is what makes it
 * safe for the API to `parse` a database row and send the result as a
 * response body.
 *
 * `createdAt`/`updatedAt` are optional: they always exist on a database row,
 * but trimmed payloads legitimately drop them, and rejecting those would be
 * noise rather than safety.
 *
 * @module @desi-event/schemas/entities
 */ var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/zod@4.6.5/node_modules/zod/v4/classic/external.js [app-rsc] (ecmascript) <export * as z>");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/schemas/src/primitives.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$enums$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/schemas/src/enums.js [app-rsc] (ecmascript)");
;
;
;
/** Audit columns shared by most models. */ const auditColumns = {
    createdAt: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["timestampSchema"].optional(),
    updatedAt: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["timestampSchema"].optional()
};
const userSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    id: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"],
    email: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["emailSchema"],
    passwordHash: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().min(1).max(255),
    displayName: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["nonEmptyStringSchema"],
    phone: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["phoneSchema"].nullish(),
    locale: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["localeSchema"].default('en-IN'),
    role: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$enums$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["userRoleSchema"].default('ATTENDEE'),
    emailVerified: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].boolean().default(false),
    ...auditColumns
});
const publicUserSchema = userSchema.omit({
    passwordHash: true,
    updatedAt: true
});
const membershipSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    id: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"],
    userId: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"],
    organizationId: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"],
    role: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$enums$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["orgRoleSchema"].default('VIEWER'),
    createdAt: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["timestampSchema"].optional()
});
const organizationSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    id: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"],
    name: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["nonEmptyStringSchema"],
    slug: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["slugSchema"],
    description: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["richTextSchema"].nullish(),
    contactEmail: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["emailSchema"],
    websiteUrl: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["urlSchema"].nullish(),
    verified: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].boolean().default(false),
    payoutCurrency: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["currencySchema"].default('INR'),
    ...auditColumns
});
const publicOrganizerSummarySchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    id: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"],
    name: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["nonEmptyStringSchema"],
    slug: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["slugSchema"],
    description: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["richTextSchema"].nullish(),
    websiteUrl: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["urlSchema"].nullish(),
    verified: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].boolean().default(false)
});
const venueSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    id: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"],
    name: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["nonEmptyStringSchema"],
    addressLine1: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["nonEmptyStringSchema"],
    addressLine2: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["nonEmptyStringSchema"].nullish(),
    city: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["nonEmptyStringSchema"],
    region: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["nonEmptyStringSchema"],
    postalCode: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().min(1).max(16),
    country: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["countrySchema"].default('IN'),
    latitude: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["latitudeSchema"].nullish(),
    longitude: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["longitudeSchema"].nullish(),
    capacity: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["countSchema"].nullish(),
    ...auditColumns
});
const eventSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    id: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"],
    organizationId: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"],
    venueId: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"].nullish(),
    title: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["nonEmptyStringSchema"],
    slug: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["slugSchema"],
    summary: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["nonEmptyStringSchema"],
    description: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["richTextSchema"],
    category: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$enums$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["eventCategorySchema"],
    status: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$enums$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["eventStatusSchema"].default('DRAFT'),
    startsAt: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["timestampSchema"],
    endsAt: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["timestampSchema"],
    timezone: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["timezoneSchema"].default('Asia/Kolkata'),
    coverImageUrl: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["urlSchema"].nullish(),
    isOnline: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].boolean().default(false),
    onlineUrl: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["urlSchema"].nullish(),
    languages: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].array(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["nonEmptyStringSchema"]).max(12).default([]),
    publishedAt: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["timestampSchema"].nullish(),
    ...auditColumns
});
const eventSummarySchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    id: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"],
    organizationId: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"],
    title: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["nonEmptyStringSchema"],
    slug: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["slugSchema"],
    summary: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["nonEmptyStringSchema"],
    category: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$enums$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["eventCategorySchema"],
    status: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$enums$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["eventStatusSchema"],
    startsAt: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["timestampSchema"],
    endsAt: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["timestampSchema"],
    timezone: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["timezoneSchema"].default('Asia/Kolkata'),
    coverImageUrl: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["urlSchema"].nullish(),
    isOnline: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].boolean().default(false),
    city: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["nonEmptyStringSchema"].nullish(),
    venueName: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["nonEmptyStringSchema"].nullish(),
    organizationName: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["nonEmptyStringSchema"].nullish(),
    /**
   * The organiser's slug, so a card can link to their page without a second
   * request. Nullish because a summary built from a row with no organisation
   * joined has no honest answer, and guessing one would produce a dead link.
   */ organizationSlug: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["slugSchema"].nullish(),
    minPriceCents: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["centsSchema"].nullish(),
    currency: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["currencySchema"].nullish(),
    soldOut: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].boolean().optional()
});
const ticketTypeSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    id: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"],
    eventId: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"],
    name: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["nonEmptyStringSchema"],
    description: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["nonEmptyStringSchema"].nullish(),
    priceCents: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["centsSchema"],
    currency: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["currencySchema"].default('INR'),
    quantityTotal: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["countSchema"],
    quantitySold: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["countSchema"].default(0),
    minPerOrder: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["quantitySchema"].default(1),
    maxPerOrder: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["quantitySchema"].default(10),
    salesStartAt: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["timestampSchema"].nullish(),
    salesEndAt: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["timestampSchema"].nullish(),
    status: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$enums$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["ticketTypeStatusSchema"].default('DRAFT'),
    sortOrder: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].int().min(0).max(10_000).default(0),
    ...auditColumns
});
const ticketHoldSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    id: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"],
    ticketTypeId: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"],
    orderId: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"].nullish(),
    quantity: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["quantitySchema"],
    status: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$enums$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["holdStatusSchema"].default('ACTIVE'),
    expiresAt: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["timestampSchema"],
    ...auditColumns
});
const orderItemSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    id: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"],
    orderId: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"],
    ticketTypeId: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"],
    quantity: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["quantitySchema"],
    unitPriceCents: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["centsSchema"],
    subtotalCents: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["centsSchema"]
});
const orderSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    id: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"],
    reference: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["orderReferenceSchema"],
    eventId: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"],
    userId: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"].nullish(),
    buyerEmail: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["emailSchema"],
    buyerName: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["nonEmptyStringSchema"],
    status: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$enums$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["orderStatusSchema"].default('PENDING'),
    currency: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["currencySchema"].default('INR'),
    subtotalCents: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["centsSchema"],
    discountCents: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["centsSchema"].default(0),
    feesCents: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["centsSchema"].default(0),
    taxCents: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["centsSchema"].default(0),
    totalCents: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["centsSchema"],
    promoCodeId: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"].nullish(),
    expiresAt: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["timestampSchema"].nullish(),
    paidAt: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["timestampSchema"].nullish(),
    cancelledAt: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["timestampSchema"].nullish(),
    ...auditColumns
});
const ticketSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    id: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"],
    orderItemId: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"],
    code: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["ticketCodeSchema"],
    attendeeName: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["nonEmptyStringSchema"].nullish(),
    status: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$enums$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["ticketStatusSchema"].default('VALID'),
    checkedInAt: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["timestampSchema"].nullish(),
    ...auditColumns
});
const paymentSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    id: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"],
    orderId: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"],
    provider: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["nonEmptyStringSchema"],
    providerRef: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().min(1).max(255).nullish(),
    status: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$enums$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["paymentStatusSchema"].default('INITIATED'),
    amountCents: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["centsSchema"],
    currency: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["currencySchema"].default('INR'),
    failureCode: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().min(1).max(64).nullish(),
    ...auditColumns
});
const promoCodeSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    id: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"],
    organizationId: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"],
    eventId: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"].nullish(),
    code: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["promoCodeStringSchema"],
    type: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$enums$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["promoTypeSchema"],
    value: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].int().min(0).max(1_000_000_000),
    maxRedemptions: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["countSchema"].nullish(),
    redemptionCount: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["countSchema"].default(0),
    startsAt: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["timestampSchema"].nullish(),
    endsAt: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["timestampSchema"].nullish(),
    active: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].boolean().default(true),
    ...auditColumns
}).refine((promo)=>promo.type !== 'PERCENTAGE' || promo.value <= 10_000, {
    message: 'A PERCENTAGE promo code value is basis points and cannot exceed 10000 (100%)',
    path: [
        'value'
    ]
});
const waitlistEntrySchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    id: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"],
    eventId: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"],
    userId: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"].nullish(),
    email: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["emailSchema"],
    quantity: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["quantitySchema"].default(1),
    notified: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].boolean().default(false),
    createdAt: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["timestampSchema"].optional()
});
const auditLogSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    id: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"],
    actorId: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"].nullish(),
    action: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["nonEmptyStringSchema"],
    entityType: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["nonEmptyStringSchema"],
    entityId: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["nonEmptyStringSchema"],
    metadata: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].record(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string(), __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].unknown()).nullish(),
    createdAt: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["timestampSchema"].optional()
});
const eventWithRelationsSchema = eventSchema.extend({
    venue: venueSchema.nullish(),
    organization: publicOrganizerSummarySchema.nullish(),
    ticketTypes: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].array(ticketTypeSchema).default([])
});
const orderWithItemsSchema = orderSchema.extend({
    items: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].array(orderItemSchema).default([]),
    tickets: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].array(ticketSchema).optional(),
    event: eventSummarySchema.nullish()
});
}),
"[project]/packages/schemas/src/enums.js [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "AUTH_TOKEN_PURPOSES",
    ()=>AUTH_TOKEN_PURPOSES,
    "CHECK_IN_METHODS",
    ()=>CHECK_IN_METHODS,
    "CONNECT_ONBOARDING_STATUSES",
    ()=>CONNECT_ONBOARDING_STATUSES,
    "DISPUTE_STATUSES",
    ()=>DISPUTE_STATUSES,
    "EVENT_CATEGORIES",
    ()=>EVENT_CATEGORIES,
    "EVENT_SEAT_STATUSES",
    ()=>EVENT_SEAT_STATUSES,
    "EVENT_SESSION_STATUSES",
    ()=>EVENT_SESSION_STATUSES,
    "EVENT_STATUSES",
    ()=>EVENT_STATUSES,
    "HOLD_STATUSES",
    ()=>HOLD_STATUSES,
    "INVITATION_STATUSES",
    ()=>INVITATION_STATUSES,
    "LEDGER_ACCOUNT_TYPES",
    ()=>LEDGER_ACCOUNT_TYPES,
    "LEDGER_BATCH_KINDS",
    ()=>LEDGER_BATCH_KINDS,
    "LEDGER_BATCH_STATUSES",
    ()=>LEDGER_BATCH_STATUSES,
    "LEDGER_DIRECTIONS",
    ()=>LEDGER_DIRECTIONS,
    "LOG_LEVELS",
    ()=>LOG_LEVELS,
    "MEDIA_MODERATION_STATUSES",
    ()=>MEDIA_MODERATION_STATUSES,
    "MEDIA_SCAN_STATUSES",
    ()=>MEDIA_SCAN_STATUSES,
    "MFA_FACTOR_TYPES",
    ()=>MFA_FACTOR_TYPES,
    "NODE_ENVS",
    ()=>NODE_ENVS,
    "NOTIFICATION_CHANNELS",
    ()=>NOTIFICATION_CHANNELS,
    "NOTIFICATION_STATUSES",
    ()=>NOTIFICATION_STATUSES,
    "ORDER_STATUSES",
    ()=>ORDER_STATUSES,
    "ORG_ROLES",
    ()=>ORG_ROLES,
    "PAYMENT_STATUSES",
    ()=>PAYMENT_STATUSES,
    "PAYOUT_STATUSES",
    ()=>PAYOUT_STATUSES,
    "PRIVATE_EVENT_STATUSES",
    ()=>PRIVATE_EVENT_STATUSES,
    "PROMO_TYPES",
    ()=>PROMO_TYPES,
    "PUBLIC_EVENT_STATUSES",
    ()=>PUBLIC_EVENT_STATUSES,
    "RECONCILIATION_KINDS",
    ()=>RECONCILIATION_KINDS,
    "RECONCILIATION_STATES",
    ()=>RECONCILIATION_STATES,
    "REFUND_REASONS",
    ()=>REFUND_REASONS,
    "REFUND_STATUSES",
    ()=>REFUND_STATUSES,
    "SECTION_KINDS",
    ()=>SECTION_KINDS,
    "TICKET_STATUSES",
    ()=>TICKET_STATUSES,
    "TICKET_TRANSFER_STATUSES",
    ()=>TICKET_TRANSFER_STATUSES,
    "TICKET_TYPE_STATUSES",
    ()=>TICKET_TYPE_STATUSES,
    "TRANSFER_STATUSES",
    ()=>TRANSFER_STATUSES,
    "USER_ROLES",
    ()=>USER_ROLES,
    "VERIFICATION_STATUSES",
    ()=>VERIFICATION_STATUSES,
    "WEBHOOK_STATES",
    ()=>WEBHOOK_STATES,
    "authTokenPurposeSchema",
    ()=>authTokenPurposeSchema,
    "checkInMethodSchema",
    ()=>checkInMethodSchema,
    "connectOnboardingStatusSchema",
    ()=>connectOnboardingStatusSchema,
    "disputeStatusSchema",
    ()=>disputeStatusSchema,
    "eventCategorySchema",
    ()=>eventCategorySchema,
    "eventSeatStatusSchema",
    ()=>eventSeatStatusSchema,
    "eventSessionStatusSchema",
    ()=>eventSessionStatusSchema,
    "eventStatusSchema",
    ()=>eventStatusSchema,
    "holdStatusSchema",
    ()=>holdStatusSchema,
    "invitationStatusSchema",
    ()=>invitationStatusSchema,
    "ledgerAccountTypeSchema",
    ()=>ledgerAccountTypeSchema,
    "ledgerBatchKindSchema",
    ()=>ledgerBatchKindSchema,
    "ledgerBatchStatusSchema",
    ()=>ledgerBatchStatusSchema,
    "ledgerDirectionSchema",
    ()=>ledgerDirectionSchema,
    "logLevelSchema",
    ()=>logLevelSchema,
    "mediaModerationStatusSchema",
    ()=>mediaModerationStatusSchema,
    "mediaScanStatusSchema",
    ()=>mediaScanStatusSchema,
    "mfaFactorTypeSchema",
    ()=>mfaFactorTypeSchema,
    "nodeEnvSchema",
    ()=>nodeEnvSchema,
    "notificationChannelSchema",
    ()=>notificationChannelSchema,
    "notificationStatusSchema",
    ()=>notificationStatusSchema,
    "orderStatusSchema",
    ()=>orderStatusSchema,
    "orgRoleSchema",
    ()=>orgRoleSchema,
    "paymentStatusSchema",
    ()=>paymentStatusSchema,
    "payoutStatusSchema",
    ()=>payoutStatusSchema,
    "promoTypeSchema",
    ()=>promoTypeSchema,
    "publicEventStatusSchema",
    ()=>publicEventStatusSchema,
    "reconciliationKindSchema",
    ()=>reconciliationKindSchema,
    "reconciliationStateSchema",
    ()=>reconciliationStateSchema,
    "refundReasonSchema",
    ()=>refundReasonSchema,
    "refundStatusSchema",
    ()=>refundStatusSchema,
    "sectionKindSchema",
    ()=>sectionKindSchema,
    "ticketStatusSchema",
    ()=>ticketStatusSchema,
    "ticketTransferStatusSchema",
    ()=>ticketTransferStatusSchema,
    "ticketTypeStatusSchema",
    ()=>ticketTypeStatusSchema,
    "transferStatusSchema",
    ()=>transferStatusSchema,
    "userRoleSchema",
    ()=>userRoleSchema,
    "verificationStatusSchema",
    ()=>verificationStatusSchema,
    "webhookStateSchema",
    ()=>webhookStateSchema
]);
/**
 * Runtime mirrors of the Prisma enums.
 *
 * These are hand-written rather than derived from `@desi-event/db` on purpose:
 * the browser bundle imports schemas but must never pull in `@prisma/client`.
 *
 * `enums.test.js` guards the two definitions against drifting apart, and since
 * Phase 2 it does so by **parsing `schema.prisma`** rather than comparing this
 * file against a second hand-written copy of the same lists. The old guard could
 * not detect drift at all: when the corrective cycle added `PENDING` and
 * `TIMEOUT` to the Prisma `PaymentStatus`, neither this file nor the test's
 * expectation was updated, both sides still agreed with each other, and the
 * suite stayed green while `paymentStatusSchema` rejected two states the
 * application actually writes. Recorded as NF-03.
 *
 * Every Prisma enum must either appear here or be listed in the test's
 * `NOT_MIRRORED` map with a reason.
 *
 * @module @desi-event/schemas/enums
 */ var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/zod@4.6.5/node_modules/zod/v4/classic/external.js [app-rsc] (ecmascript) <export * as z>");
;
const PUBLIC_EVENT_STATUSES = Object.freeze([
    'PUBLISHED',
    'ON_SALE',
    'SALES_PAUSED',
    'SOLD_OUT'
]);
const USER_ROLES = Object.freeze([
    'ATTENDEE',
    'ORGANIZER',
    'SUPPORT',
    'MODERATOR',
    'FINANCE_ADMIN',
    'SUPER_ADMIN'
]);
const ORG_ROLES = Object.freeze([
    'OWNER',
    'ADMIN',
    'EVENT_MANAGER',
    'FINANCE',
    'MANAGER',
    'STAFF',
    'SCANNER',
    'VIEWER'
]);
const EVENT_CATEGORIES = Object.freeze([
    'MUSIC_CONCERT',
    'GARBA_DANDIYA',
    'BOLLYWOOD_NIGHT',
    'CLASSICAL_DANCE',
    'COMEDY',
    'FILM_SCREENING',
    'CULTURAL_FESTIVAL',
    'FOOD_FESTIVAL',
    'WEDDING_EXPO',
    'RELIGIOUS',
    'THEATRE',
    'WORKSHOP',
    'NETWORKING',
    'SPORTS'
]);
const EVENT_STATUSES = Object.freeze([
    'DRAFT',
    'REVIEW_PENDING',
    'CHANGES_REQUIRED',
    'APPROVED',
    'PUBLISHED',
    'ON_SALE',
    'SALES_PAUSED',
    'SOLD_OUT',
    'COMPLETED',
    'POSTPONED',
    'CANCELLED',
    'REJECTED',
    'ARCHIVED'
]);
const TICKET_TYPE_STATUSES = Object.freeze([
    'DRAFT',
    'ON_SALE',
    'PAUSED',
    'SOLD_OUT',
    'CLOSED'
]);
const HOLD_STATUSES = Object.freeze([
    'ACTIVE',
    'CONVERTED',
    'RELEASED',
    'EXPIRED'
]);
const ORDER_STATUSES = Object.freeze([
    'PENDING',
    'PAID',
    'CANCELLED',
    'REFUNDED',
    'EXPIRED'
]);
const TICKET_STATUSES = Object.freeze([
    'VALID',
    'CHECKED_IN',
    'VOID',
    'REFUNDED',
    'TRANSFERRED',
    'SUPERSEDED',
    'CANCELLED'
]);
const PAYMENT_STATUSES = Object.freeze([
    'INITIATED',
    'PENDING',
    'SUCCEEDED',
    'FAILED',
    'TIMEOUT',
    'REQUIRES_ACTION',
    'CANCELLED',
    'REFUNDED',
    'PARTIALLY_REFUNDED'
]);
const WEBHOOK_STATES = Object.freeze([
    'RECEIVED',
    'PROCESSING',
    'PROCESSED',
    'IGNORED',
    'FAILED',
    'DEAD_LETTER'
]);
const PROMO_TYPES = Object.freeze([
    'PERCENTAGE',
    'FIXED_AMOUNT'
]);
const MFA_FACTOR_TYPES = Object.freeze([
    'TOTP',
    'RECOVERY_CODE',
    'WEBAUTHN'
]);
const AUTH_TOKEN_PURPOSES = Object.freeze([
    'EMAIL_VERIFICATION',
    'PASSWORD_RESET',
    'TICKET_CLAIM',
    'TICKET_TRANSFER',
    'CONNECT_ONBOARDING'
]);
const VERIFICATION_STATUSES = Object.freeze([
    'UNVERIFIED',
    'PENDING',
    'REQUIRES_INFORMATION',
    'VERIFIED',
    'REJECTED',
    'SUSPENDED',
    'REVOKED'
]);
const INVITATION_STATUSES = Object.freeze([
    'PENDING',
    'ACCEPTED',
    'REVOKED',
    'EXPIRED'
]);
const SECTION_KINDS = Object.freeze([
    'SEATED',
    'STANDING',
    'TABLE'
]);
const EVENT_SESSION_STATUSES = Object.freeze([
    'SCHEDULED',
    'ON_SALE',
    'SALES_PAUSED',
    'SOLD_OUT',
    'CANCELLED',
    'COMPLETED'
]);
const EVENT_SEAT_STATUSES = Object.freeze([
    'AVAILABLE',
    'HELD',
    'SOLD',
    'BLOCKED',
    'COMPLIMENTARY',
    'KILLED'
]);
const MEDIA_MODERATION_STATUSES = Object.freeze([
    'PENDING',
    'APPROVED',
    'REJECTED'
]);
const MEDIA_SCAN_STATUSES = Object.freeze([
    'PENDING',
    'CLEAN',
    'INFECTED',
    'ERROR'
]);
const CONNECT_ONBOARDING_STATUSES = Object.freeze([
    'NOT_STARTED',
    'IN_PROGRESS',
    'REQUIREMENTS_DUE',
    'COMPLETE',
    'DISABLED'
]);
const REFUND_STATUSES = Object.freeze([
    'REQUESTED',
    'APPROVED',
    'PROCESSING',
    'SUCCEEDED',
    'FAILED',
    'RECONCILIATION_REQUIRED',
    'REJECTED',
    'CANCELLED'
]);
const REFUND_REASONS = Object.freeze([
    'EVENT_CANCELLED',
    'EVENT_POSTPONED',
    'DUPLICATE_ORDER',
    'CUSTOMER_REQUEST',
    'ORGANIZER_GOODWILL',
    'FRAUDULENT',
    'OTHER'
]);
const DISPUTE_STATUSES = Object.freeze([
    'NEEDS_RESPONSE',
    'UNDER_REVIEW',
    'CHARGE_REFUNDED',
    'WON',
    'LOST',
    'WARNING_NEEDS_RESPONSE',
    'WARNING_CLOSED'
]);
const TRANSFER_STATUSES = Object.freeze([
    'PENDING',
    'SENT',
    'PAID',
    'FAILED',
    'REVERSED',
    'PARTIALLY_REVERSED',
    'RECONCILIATION_REQUIRED'
]);
const PAYOUT_STATUSES = Object.freeze([
    'PENDING',
    'IN_TRANSIT',
    'PAID',
    'FAILED',
    'CANCELLED'
]);
const LEDGER_ACCOUNT_TYPES = Object.freeze([
    'ASSET',
    'LIABILITY',
    'REVENUE',
    'EXPENSE',
    'CONTRA_REVENUE'
]);
const LEDGER_BATCH_STATUSES = Object.freeze([
    'DRAFT',
    'POSTED',
    'VOID'
]);
const LEDGER_BATCH_KINDS = Object.freeze([
    'ORDER_PAID',
    'REFUND',
    'DISPUTE_OPENED',
    'DISPUTE_RESOLVED',
    'TRANSFER',
    'TRANSFER_REVERSAL',
    'PAYOUT',
    'PLATFORM_FEE',
    'CORRECTION'
]);
const LEDGER_DIRECTIONS = Object.freeze([
    'DEBIT',
    'CREDIT'
]);
const TICKET_TRANSFER_STATUSES = Object.freeze([
    'PENDING',
    'ACCEPTED',
    'DECLINED',
    'CANCELLED',
    'EXPIRED'
]);
const CHECK_IN_METHODS = Object.freeze([
    'QR_SCAN',
    'MANUAL_LOOKUP',
    'ASSISTED'
]);
const NOTIFICATION_CHANNELS = Object.freeze([
    'EMAIL',
    'SMS',
    'PUSH'
]);
const NOTIFICATION_STATUSES = Object.freeze([
    'QUEUED',
    'SENDING',
    'SENT',
    'FAILED',
    'DEAD_LETTER',
    'SUPPRESSED'
]);
const RECONCILIATION_STATES = Object.freeze([
    'OPEN',
    'IN_PROGRESS',
    'RESOLVED',
    'ESCALATED'
]);
const RECONCILIATION_KINDS = Object.freeze([
    'PAYMENT_TIMEOUT',
    'PROVIDER_MISMATCH',
    'REFUND_UNKNOWN',
    'WEBHOOK_DEAD_LETTER',
    'TRANSFER_STUCK'
]);
const userRoleSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].enum([
    ...USER_ROLES
]);
const orgRoleSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].enum([
    ...ORG_ROLES
]);
const eventCategorySchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].enum([
    ...EVENT_CATEGORIES
]);
const eventStatusSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].enum([
    ...EVENT_STATUSES
]);
const ticketTypeStatusSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].enum([
    ...TICKET_TYPE_STATUSES
]);
const holdStatusSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].enum([
    ...HOLD_STATUSES
]);
const orderStatusSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].enum([
    ...ORDER_STATUSES
]);
const ticketStatusSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].enum([
    ...TICKET_STATUSES
]);
const paymentStatusSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].enum([
    ...PAYMENT_STATUSES
]);
const webhookStateSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].enum([
    ...WEBHOOK_STATES
]);
const promoTypeSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].enum([
    ...PROMO_TYPES
]);
const mfaFactorTypeSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].enum([
    ...MFA_FACTOR_TYPES
]);
const authTokenPurposeSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].enum([
    ...AUTH_TOKEN_PURPOSES
]);
const verificationStatusSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].enum([
    ...VERIFICATION_STATUSES
]);
const invitationStatusSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].enum([
    ...INVITATION_STATUSES
]);
const sectionKindSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].enum([
    ...SECTION_KINDS
]);
const eventSessionStatusSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].enum([
    ...EVENT_SESSION_STATUSES
]);
const eventSeatStatusSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].enum([
    ...EVENT_SEAT_STATUSES
]);
const mediaModerationStatusSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].enum([
    ...MEDIA_MODERATION_STATUSES
]);
const mediaScanStatusSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].enum([
    ...MEDIA_SCAN_STATUSES
]);
const connectOnboardingStatusSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].enum([
    ...CONNECT_ONBOARDING_STATUSES
]);
const refundStatusSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].enum([
    ...REFUND_STATUSES
]);
const refundReasonSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].enum([
    ...REFUND_REASONS
]);
const disputeStatusSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].enum([
    ...DISPUTE_STATUSES
]);
const transferStatusSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].enum([
    ...TRANSFER_STATUSES
]);
const payoutStatusSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].enum([
    ...PAYOUT_STATUSES
]);
const ledgerAccountTypeSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].enum([
    ...LEDGER_ACCOUNT_TYPES
]);
const ledgerBatchStatusSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].enum([
    ...LEDGER_BATCH_STATUSES
]);
const ledgerBatchKindSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].enum([
    ...LEDGER_BATCH_KINDS
]);
const ledgerDirectionSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].enum([
    ...LEDGER_DIRECTIONS
]);
const ticketTransferStatusSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].enum([
    ...TICKET_TRANSFER_STATUSES
]);
const checkInMethodSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].enum([
    ...CHECK_IN_METHODS
]);
const notificationChannelSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].enum([
    ...NOTIFICATION_CHANNELS
]);
const notificationStatusSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].enum([
    ...NOTIFICATION_STATUSES
]);
const reconciliationStateSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].enum([
    ...RECONCILIATION_STATES
]);
const reconciliationKindSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].enum([
    ...RECONCILIATION_KINDS
]);
const PRIVATE_EVENT_STATUSES = Object.freeze(EVENT_STATUSES.filter((status)=>!PUBLIC_EVENT_STATUSES.includes(status)));
const publicEventStatusSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].enum([
    ...PUBLIC_EVENT_STATUSES
]);
const LOG_LEVELS = Object.freeze([
    'fatal',
    'error',
    'warn',
    'info',
    'debug',
    'trace'
]);
const NODE_ENVS = Object.freeze([
    'development',
    'test',
    'production'
]);
const logLevelSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].enum([
    ...LOG_LEVELS
]);
const nodeEnvSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].enum([
    ...NODE_ENVS
]).default('development');
}),
"[project]/packages/schemas/src/index.js [app-rsc] (ecmascript) <locals>", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([]);
/**
 * `@desi-event/schemas` — the single source of truth for validation.
 *
 * The API validates requests, responses, job payloads and its own environment
 * with these schemas; the worker validates the jobs it consumes; the web app
 * validates forms before they leave the browser; and `@desi-event/api-contract`
 * renders them to JSON Schema for the OpenAPI document. Because there is no
 * compiler in this repository, these schemas *are* the type system.
 *
 * Nothing here imports `@prisma/client`, so the browser bundle stays clean.
 *
 * @module @desi-event/schemas
 */ var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$payments$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/schemas/src/payments.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/schemas/src/primitives.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$enums$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/schemas/src/enums.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$entities$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/schemas/src/entities.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$requests$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/schemas/src/requests.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$auth$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/schemas/src/auth.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$teams$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/schemas/src/teams.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$verification$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/schemas/src/verification.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$seating$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/schemas/src/seating.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$payments$2d$wire$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/schemas/src/payments-wire.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$responses$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/schemas/src/responses.js [app-rsc] (ecmascript)"); // `env.js` and `jobs.js` are deliberately NOT re-exported here — finding NF-16.
 //
 // This barrel is imported by `@desi-event/api-contract/routes.js`, which is
 // imported by the browser. Because a barrel is all-or-nothing, one named import
 // of one request schema put the API and worker deployment contract into the
 // client bundle: the PostgreSQL and Redis variable names, the 32-character
 // floor on JWT_SECRET, the AUTH_SECRET-falls-back-to-JWT_SECRET rule, the fee
 // constants, and the verbatim list of placeholder secrets the platform refuses
 // in production — which is a precise statement of the check an attacker is
 // probing against.
 //
 // Neither module was ever wanted in a browser. They live at
 // `@desi-event/schemas/env` and `@desi-event/schemas/jobs`, where the servers
 // and the worker ask for them by name.
;
;
;
;
;
;
;
;
;
;
;
;
}),
"[project]/packages/schemas/src/payments-wire.js [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "webhookAckResponseSchema",
    ()=>webhookAckResponseSchema
]);
/**
 * What a webhook endpoint answers with.
 *
 * Deliberately almost nothing. A webhook sender is a machine that needs to know
 * whether to retry, and telling it anything else — which payment, which order,
 * what changed — would put internal identifiers in a response to an
 * unauthenticated caller.
 *
 * `duplicate` is the one useful bit beyond the acknowledgement: it lets an
 * operator replaying a delivery by hand see that it had already been stored,
 * rather than wondering whether their replay did anything.
 *
 * @module @desi-event/schemas/payments-wire
 */ var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/zod@4.6.5/node_modules/zod/v4/classic/external.js [app-rsc] (ecmascript) <export * as z>");
;
const webhookAckResponseSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    ok: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].literal(true),
    duplicate: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].boolean().default(false)
});
}),
"[project]/packages/schemas/src/payments.js [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/**
 * What this system can do with money, stated once.
 *
 * Desi-Event can run in exactly two payment modes, and neither of them moves
 * real money:
 *
 *   - `MOCK` — the default. An in-memory adapter that authorises, captures and
 *     refunds nothing, and opens no socket. This is what a fresh clone, CI, a
 *     preview deployment and a credential-free demonstration all run.
 *   - `STRIPE_TEST` — Stripe's sandbox, reached only when a coherent set of
 *     *test* credentials is supplied on purpose. Test keys, test connected
 *     accounts, signed test webhooks. No live money, and no live key will start
 *     it.
 *
 * There is no third mode. `LIVE` is deliberately absent rather than present and
 * disabled: naming a mode no code path reaches would be a lie, and a constant
 * called `LIVE` is a constant somebody eventually tries to use. Production card
 * processing remains a Phase 2 exit criterion — a merchant account,
 * reconciliation operations, real refunds, real payouts and a tax
 * determination, none of which is in this repository.
 *
 * These constants live in the shared vocabulary rather than in the provider
 * package because four different processes have to agree on them: the API
 * reports the mode on its liveness probe, the worker stamps it on receipts and
 * passes, the web app says it to the buyer before they reach a quantity
 * stepper, and the browser needs the publishable key. One set of strings, so
 * none of them can drift into disagreeing about whether money moves.
 *
 * @module @desi-event/schemas/payments
 */ /**
 * The payment modes that exist.
 *
 * The values are the strings reported on the wire and stored on rows, so they
 * are stable. The environment spells them in lower case — see
 * {@link PAYMENT_MODE_ENV_VALUES} — because that is how people write
 * environment variables.
 *
 * @type {Readonly<Record<string, string>>}
 */ __turbopack_context__.s([
    "DEMO_LABEL",
    ()=>DEMO_LABEL,
    "DEMO_PAYMENT_NOTICE",
    ()=>DEMO_PAYMENT_NOTICE,
    "DEMO_TICKET_NOTICE",
    ()=>DEMO_TICKET_NOTICE,
    "PAYMENT_MODES",
    ()=>PAYMENT_MODES,
    "PAYMENT_MODE_ENV_VALUES",
    ()=>PAYMENT_MODE_ENV_VALUES,
    "PRODUCTION_PAYMENTS_DISABLED_MESSAGE",
    ()=>PRODUCTION_PAYMENTS_DISABLED_MESSAGE,
    "PROHIBITED_PAYMENT_MODE_VALUES",
    ()=>PROHIBITED_PAYMENT_MODE_VALUES,
    "SANDBOX_LABEL",
    ()=>SANDBOX_LABEL,
    "SANDBOX_PAYMENT_NOTICE",
    ()=>SANDBOX_PAYMENT_NOTICE,
    "SANDBOX_TICKET_NOTICE",
    ()=>SANDBOX_TICKET_NOTICE,
    "STRIPE_API_VERSION",
    ()=>STRIPE_API_VERSION,
    "labelFor",
    ()=>labelFor,
    "paymentNoticeFor",
    ()=>paymentNoticeFor,
    "ticketNoticeFor",
    ()=>ticketNoticeFor
]);
const PAYMENT_MODES = Object.freeze({
    MOCK: 'MOCK',
    STRIPE_TEST: 'STRIPE_TEST'
});
const PAYMENT_MODE_ENV_VALUES = Object.freeze({
    mock: PAYMENT_MODES.MOCK,
    demo: PAYMENT_MODES.MOCK,
    'in-memory': PAYMENT_MODES.MOCK,
    none: PAYMENT_MODES.MOCK,
    stripe_test: PAYMENT_MODES.STRIPE_TEST,
    'stripe-test': PAYMENT_MODES.STRIPE_TEST,
    stripe_sandbox: PAYMENT_MODES.STRIPE_TEST
});
const PROHIBITED_PAYMENT_MODE_VALUES = Object.freeze([
    'live',
    'production',
    'prod',
    'real',
    'stripe',
    'stripe_live',
    'stripe-live'
]);
const STRIPE_API_VERSION = '2025-08-27.basil';
const DEMO_LABEL = 'DEMO';
const SANDBOX_LABEL = 'SANDBOX';
const PRODUCTION_PAYMENTS_DISABLED_MESSAGE = 'Production payments disabled — Phase 2 integration required.';
const DEMO_PAYMENT_NOTICE = 'DEMO — no money moved, no card was charged, and this is not a valid receipt.';
const DEMO_TICKET_NOTICE = 'DEMO — this pass was issued by a demonstration system and admits nobody.';
const SANDBOX_PAYMENT_NOTICE = "SANDBOX — settled in Stripe's test mode. No real money moved and this is not a valid receipt.";
const SANDBOX_TICKET_NOTICE = 'SANDBOX — this pass was issued against a Stripe test payment and admits nobody.';
function paymentNoticeFor(mode) {
    return mode === PAYMENT_MODES.STRIPE_TEST ? SANDBOX_PAYMENT_NOTICE : DEMO_PAYMENT_NOTICE;
}
function ticketNoticeFor(mode) {
    return mode === PAYMENT_MODES.STRIPE_TEST ? SANDBOX_TICKET_NOTICE : DEMO_TICKET_NOTICE;
}
function labelFor(mode) {
    return mode === PAYMENT_MODES.STRIPE_TEST ? SANDBOX_LABEL : DEMO_LABEL;
}
}),
"[project]/packages/schemas/src/primitives.js [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "DEFAULT_PAGE",
    ()=>DEFAULT_PAGE,
    "DEFAULT_PER_PAGE",
    ()=>DEFAULT_PER_PAGE,
    "MAX_CENTS",
    ()=>MAX_CENTS,
    "MAX_ID_LENGTH",
    ()=>MAX_ID_LENGTH,
    "MAX_PAGE",
    ()=>MAX_PAGE,
    "MAX_PER_PAGE",
    ()=>MAX_PER_PAGE,
    "bpsSchema",
    ()=>bpsSchema,
    "centsSchema",
    ()=>centsSchema,
    "countSchema",
    ()=>countSchema,
    "countrySchema",
    ()=>countrySchema,
    "cuidSchema",
    ()=>cuidSchema,
    "currencySchema",
    ()=>currencySchema,
    "emailSchema",
    ()=>emailSchema,
    "isoDateTimeSchema",
    ()=>isoDateTimeSchema,
    "latitudeSchema",
    ()=>latitudeSchema,
    "localeSchema",
    ()=>localeSchema,
    "longitudeSchema",
    ()=>longitudeSchema,
    "nonEmptyStringSchema",
    ()=>nonEmptyStringSchema,
    "orderReferenceSchema",
    ()=>orderReferenceSchema,
    "pageSchema",
    ()=>pageSchema,
    "paginationQuerySchema",
    ()=>paginationQuerySchema,
    "passwordSchema",
    ()=>passwordSchema,
    "perPageSchema",
    ()=>perPageSchema,
    "phoneSchema",
    ()=>phoneSchema,
    "promoCodeStringSchema",
    ()=>promoCodeStringSchema,
    "quantitySchema",
    ()=>quantitySchema,
    "queryDateTimeSchema",
    ()=>queryDateTimeSchema,
    "richTextSchema",
    ()=>richTextSchema,
    "signedCentsSchema",
    ()=>signedCentsSchema,
    "slugSchema",
    ()=>slugSchema,
    "ticketCodeSchema",
    ()=>ticketCodeSchema,
    "timestampSchema",
    ()=>timestampSchema,
    "timezoneSchema",
    ()=>timezoneSchema,
    "toSkipTake",
    ()=>toSkipTake,
    "urlSchema",
    ()=>urlSchema
]);
/**
 * Leaf schemas every other schema in this package is built from.
 *
 * Two conventions run through the file:
 *
 *  * **Normalisation happens in `z.preprocess`, never in `.transform()`.**
 *    `@desi-event/api-contract` renders these schemas to JSON Schema with
 *    `z.toJSONSchema`, and a trailing transform is not representable. A
 *    preprocess step keeps the *output* type a plain string, so the generated
 *    OpenAPI document stays accurate.
 *  * **Money is integer cents.** There is no float money schema here on
 *    purpose.
 *
 * @module @desi-event/schemas/primitives
 */ var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/zod@4.6.5/node_modules/zod/v4/classic/external.js [app-rsc] (ecmascript) <export * as z>");
;
const MAX_ID_LENGTH = 64;
const MAX_CENTS = 1_000_000_000;
const DEFAULT_PAGE = 1;
const DEFAULT_PER_PAGE = 20;
const MAX_PER_PAGE = 100;
const MAX_PAGE = 10_000;
/**
 * Trim a string, leaving every other value untouched so that the wrapped
 * schema still reports a proper `invalid_type` issue.
 *
 * @param {unknown} value Raw input.
 * @returns {unknown} Trimmed string, or `value` unchanged.
 */ function trimmed(value) {
    return typeof value === 'string' ? value.trim() : value;
}
/**
 * Trim and lower-case a string, leaving non-strings untouched.
 *
 * @param {unknown} value Raw input.
 * @returns {unknown} Normalised string, or `value` unchanged.
 */ function trimmedLower(value) {
    return typeof value === 'string' ? value.trim().toLowerCase() : value;
}
/**
 * Trim and upper-case a string, leaving non-strings untouched.
 *
 * @param {unknown} value Raw input.
 * @returns {unknown} Normalised string, or `value` unchanged.
 */ function trimmedUpper(value) {
    return typeof value === 'string' ? value.trim().toUpperCase() : value;
}
/**
 * True when the runtime recognises `value` as an IANA time zone name.
 *
 * @param {string} value Candidate zone name, e.g. `Asia/Kolkata`.
 * @returns {boolean} Whether `Intl` accepts the zone.
 */ function isKnownTimeZone(value) {
    try {
        new Intl.DateTimeFormat('en-US', {
            timeZone: value
        });
        return true;
    } catch  {
        return false;
    }
}
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const OFFSETLESS_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;
/**
 * Accept the several shapes a timestamp arrives in and normalise them to a
 * UTC ISO-8601 string.
 *
 * Prisma hands back `Date` objects, JSON bodies carry strings, and query
 * strings frequently carry a bare `YYYY-MM-DD`. All three mean the same thing
 * to a caller, so all three are accepted and an offsetless value is read as
 * UTC rather than as the server's local zone.
 *
 * @param {unknown} value Raw input.
 * @returns {unknown} An ISO-8601 string, or `value` unchanged.
 */ function toIsoString(value) {
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();
    }
    if (typeof value !== 'string') return value;
    const text = value.trim();
    if (DATE_ONLY.test(text)) return `${text}T00:00:00.000Z`;
    if (OFFSETLESS_DATETIME.test(text)) return `${text.length === 16 ? `${text}:00` : text}Z`;
    return text;
}
const cuidSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].preprocess(trimmed, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().max(MAX_ID_LENGTH).regex(/^[a-z][a-z0-9]{7,31}$/, 'Expected a CUID identifier'));
const emailSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].preprocess(trimmedLower, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].email().max(254));
const slugSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].preprocess(trimmedLower, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().min(1).max(140).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Expected a lower-case hyphenated slug'));
const currencySchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].preprocess(trimmedUpper, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().regex(/^[A-Z]{3}$/, 'Expected a three-letter ISO-4217 currency code'));
const centsSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].int().min(0).max(MAX_CENTS);
const signedCentsSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].int().min(-MAX_CENTS).max(MAX_CENTS);
const bpsSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].int().min(0).max(10_000);
const isoDateTimeSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].iso.datetime({
    offset: true
});
const timestampSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].preprocess(toIsoString, isoDateTimeSchema);
const queryDateTimeSchema = timestampSchema;
const timezoneSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].preprocess(trimmed, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().min(1).max(64).refine(isKnownTimeZone, 'Unknown IANA time zone'));
const urlSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].preprocess(trimmed, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].url().max(2048).refine((value)=>/^https?:\/\//i.test(value), 'Expected an http or https URL'));
const nonEmptyStringSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].preprocess(trimmed, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().min(1).max(500));
const richTextSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].preprocess(trimmed, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().min(1).max(20_000));
const phoneSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].preprocess(trimmed, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().min(6).max(24).regex(/^\+?[0-9][0-9 ()-]{4,}$/, 'Expected a phone number'));
const localeSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].preprocess(trimmed, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/, 'Expected a BCP-47 locale tag'));
const countrySchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].preprocess(trimmedUpper, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().regex(/^[A-Z]{2}$/, 'Expected a two-letter ISO-3166 country code'));
const latitudeSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].number().min(-90).max(90);
const longitudeSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].number().min(-180).max(180);
const passwordSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().min(8).max(128);
const ticketCodeSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].preprocess(trimmedUpper, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().min(6).max(64).regex(/^[A-Z0-9-]+$/, 'Expected an alphanumeric ticket code'));
const promoCodeStringSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].preprocess(trimmedUpper, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().min(3).max(32).regex(/^[A-Z0-9_-]+$/, 'Expected an alphanumeric promo code'));
const orderReferenceSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].preprocess(trimmedUpper, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().min(4).max(32).regex(/^[A-Z0-9-]+$/, 'Expected an alphanumeric order reference'));
const quantitySchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].int().min(1).max(50);
const countSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].int().min(0).max(10_000_000);
const pageSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].coerce.number().int().min(1).max(MAX_PAGE).default(DEFAULT_PAGE);
const perPageSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].coerce.number().int().min(1).max(MAX_PER_PAGE).default(DEFAULT_PER_PAGE);
const paginationQuerySchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    page: pageSchema,
    perPage: perPageSchema
});
function toSkipTake(pagination = {}) {
    const page = pagination.page ?? DEFAULT_PAGE;
    const perPage = pagination.perPage ?? DEFAULT_PER_PAGE;
    return {
        skip: (page - 1) * perPage,
        take: perPage
    };
}
}),
"[project]/packages/schemas/src/requests.js [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "EVENT_SORT_OPTIONS",
    ()=>EVENT_SORT_OPTIONS,
    "checkInRequestSchema",
    ()=>checkInRequestSchema,
    "createEventRequestSchema",
    ()=>createEventRequestSchema,
    "createHoldRequestSchema",
    ()=>createHoldRequestSchema,
    "createOrderRequestSchema",
    ()=>createOrderRequestSchema,
    "createPromoCodeRequestSchema",
    ()=>createPromoCodeRequestSchema,
    "createTicketTypeRequestSchema",
    ()=>createTicketTypeRequestSchema,
    "createVenueRequestSchema",
    ()=>createVenueRequestSchema,
    "idParamSchema",
    ()=>idParamSchema,
    "joinWaitlistRequestSchema",
    ()=>joinWaitlistRequestSchema,
    "listEventsQuerySchema",
    ()=>listEventsQuerySchema,
    "listQuerySchema",
    ()=>listQuerySchema,
    "loginRequestSchema",
    ()=>loginRequestSchema,
    "orderItemRequestSchema",
    ()=>orderItemRequestSchema,
    "paymentWebhookRequestSchema",
    ()=>paymentWebhookRequestSchema,
    "publishEventRequestSchema",
    ()=>publishEventRequestSchema,
    "registerRequestSchema",
    ()=>registerRequestSchema,
    "slugParamSchema",
    ()=>slugParamSchema,
    "updateEventRequestSchema",
    ()=>updateEventRequestSchema,
    "updateTicketTypeRequestSchema",
    ()=>updateTicketTypeRequestSchema
]);
/**
 * Request body and query schemas for the public API.
 *
 * Cross-field business rules live here rather than in route handlers: a rule
 * expressed once in the schema is enforced identically by the API, by the
 * worker replaying a payload and by the web app validating a form before it
 * ever hits the network.
 *
 * @module @desi-event/schemas/requests
 */ var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/zod@4.6.5/node_modules/zod/v4/classic/external.js [app-rsc] (ecmascript) <export * as z>");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/schemas/src/primitives.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$enums$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/schemas/src/enums.js [app-rsc] (ecmascript)");
;
;
;
const EVENT_SORT_OPTIONS = Object.freeze([
    'startsAt:asc',
    'startsAt:desc',
    'createdAt:desc',
    'title:asc'
]);
const registerRequestSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    email: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["emailSchema"],
    password: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["passwordSchema"],
    displayName: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["nonEmptyStringSchema"],
    phone: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["phoneSchema"].optional(),
    locale: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["localeSchema"].default('en-IN'),
    role: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].enum([
        'ATTENDEE',
        'ORGANIZER'
    ]).default('ATTENDEE')
});
const loginRequestSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    email: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["emailSchema"],
    password: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().min(1).max(128)
});
/**
 * Fields an organiser may supply when creating or updating an event.
 *
 * Kept as a bare object so that {@link createEventRequestSchema} and
 * {@link updateEventRequestSchema} can derive required and partial variants
 * from one definition.
 */ const eventWritableFields = {
    organizationId: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"],
    venueId: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"].nullish(),
    title: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["nonEmptyStringSchema"],
    slug: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["slugSchema"].optional(),
    summary: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["nonEmptyStringSchema"],
    description: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["richTextSchema"],
    category: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$enums$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["eventCategorySchema"],
    status: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$enums$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["eventStatusSchema"],
    startsAt: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["timestampSchema"],
    endsAt: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["timestampSchema"],
    timezone: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["timezoneSchema"],
    coverImageUrl: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["urlSchema"].nullish(),
    isOnline: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].boolean(),
    onlineUrl: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["urlSchema"].nullish(),
    languages: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].array(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["nonEmptyStringSchema"]).max(12)
};
const eventWritableObject = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object(eventWritableFields);
// Defaults live only on the create variant. `.partial()` still fills defaults
// in, so a partial built from a defaulted object would silently reset columns
// the caller never mentioned.
const createEventObject = eventWritableObject.extend({
    status: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$enums$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["eventStatusSchema"].default('DRAFT'),
    timezone: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["timezoneSchema"].default('Asia/Kolkata'),
    isOnline: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].boolean().default(false),
    languages: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].array(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["nonEmptyStringSchema"]).max(12).default([])
});
/**
 * Apply the event invariants that span more than one field.
 *
 * @param {object} value Candidate event payload.
 * @param {z.RefinementCtx} ctx Zod refinement context used to report issues.
 * @returns {void}
 */ function checkEventWindow(value, ctx) {
    const { startsAt, endsAt, isOnline, onlineUrl } = value;
    if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
        ctx.addIssue({
            code: 'custom',
            path: [
                'endsAt'
            ],
            message: 'endsAt must be strictly after startsAt'
        });
    }
    if (isOnline === true && !onlineUrl) {
        ctx.addIssue({
            code: 'custom',
            path: [
                'onlineUrl'
            ],
            message: 'onlineUrl is required when isOnline is true'
        });
    }
}
const createEventRequestSchema = createEventObject.superRefine(checkEventWindow);
const updateEventRequestSchema = eventWritableObject.partial().omit({
    organizationId: true,
    status: true
}).superRefine((value, ctx)=>{
    if (Object.keys(value).length === 0) {
        ctx.addIssue({
            code: 'custom',
            path: [],
            message: 'Provide at least one field to update'
        });
    }
    checkEventWindow(value, ctx);
});
const publishEventRequestSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    status: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$enums$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["eventStatusSchema"],
    publishedAt: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["timestampSchema"].optional()
});
const listEventsQuerySchema = __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["paginationQuerySchema"].extend({
    category: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$enums$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["eventCategorySchema"].optional(),
    status: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$enums$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["eventStatusSchema"].optional(),
    city: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["nonEmptyStringSchema"].optional(),
    q: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].preprocess((value)=>typeof value === 'string' ? value.trim() : value, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().min(1).max(120)).optional(),
    startsAfter: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["queryDateTimeSchema"].optional(),
    startsBefore: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["queryDateTimeSchema"].optional(),
    organizationId: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"].optional(),
    isOnline: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].stringbool().optional(),
    sort: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].enum([
        ...EVENT_SORT_OPTIONS
    ]).default('startsAt:asc')
}).superRefine((value, ctx)=>{
    const { startsAfter, startsBefore } = value;
    if (startsAfter && startsBefore && Date.parse(startsBefore) <= Date.parse(startsAfter)) {
        ctx.addIssue({
            code: 'custom',
            path: [
                'startsBefore'
            ],
            message: 'startsBefore must be after startsAfter'
        });
    }
});
const createVenueRequestSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    name: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["nonEmptyStringSchema"],
    addressLine1: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["nonEmptyStringSchema"],
    addressLine2: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["nonEmptyStringSchema"].optional(),
    city: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["nonEmptyStringSchema"],
    region: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["nonEmptyStringSchema"],
    postalCode: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().min(1).max(16),
    country: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().length(2).optional(),
    latitude: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["latitudeSchema"].optional(),
    longitude: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["longitudeSchema"].optional(),
    capacity: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["countSchema"].optional()
});
const ticketTypeWritableFields = {
    eventId: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"],
    name: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["nonEmptyStringSchema"],
    description: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["nonEmptyStringSchema"].nullish(),
    priceCents: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["centsSchema"],
    currency: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["currencySchema"],
    quantityTotal: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["countSchema"].min(1),
    minPerOrder: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["quantitySchema"],
    maxPerOrder: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["quantitySchema"],
    salesStartAt: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["timestampSchema"].nullish(),
    salesEndAt: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["timestampSchema"].nullish(),
    status: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$enums$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["ticketTypeStatusSchema"],
    sortOrder: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].int().min(0).max(10_000)
};
const ticketTypeWritableObject = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object(ticketTypeWritableFields);
/**
 * Apply the ticket-type invariants that span more than one field.
 *
 * @param {object} value Candidate ticket type payload.
 * @param {z.RefinementCtx} ctx Zod refinement context used to report issues.
 * @returns {void}
 */ function checkTicketTypeBounds(value, ctx) {
    const { minPerOrder, maxPerOrder, quantityTotal, salesStartAt, salesEndAt } = value;
    if (minPerOrder != null && maxPerOrder != null && maxPerOrder < minPerOrder) {
        ctx.addIssue({
            code: 'custom',
            path: [
                'maxPerOrder'
            ],
            message: 'maxPerOrder must be greater than or equal to minPerOrder'
        });
    }
    if (minPerOrder != null && quantityTotal != null && minPerOrder > quantityTotal) {
        ctx.addIssue({
            code: 'custom',
            path: [
                'minPerOrder'
            ],
            message: 'minPerOrder cannot exceed quantityTotal'
        });
    }
    if (salesStartAt && salesEndAt && Date.parse(salesEndAt) <= Date.parse(salesStartAt)) {
        ctx.addIssue({
            code: 'custom',
            path: [
                'salesEndAt'
            ],
            message: 'salesEndAt must be after salesStartAt'
        });
    }
}
const createTicketTypeRequestSchema = ticketTypeWritableObject.extend({
    currency: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["currencySchema"].default('INR'),
    minPerOrder: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["quantitySchema"].default(1),
    maxPerOrder: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["quantitySchema"].default(10),
    status: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$enums$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["ticketTypeStatusSchema"].default('DRAFT'),
    sortOrder: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].int().min(0).max(10_000).default(0)
}).superRefine(checkTicketTypeBounds);
const updateTicketTypeRequestSchema = ticketTypeWritableObject.partial().omit({
    eventId: true
}).superRefine((value, ctx)=>{
    if (Object.keys(value).length === 0) {
        ctx.addIssue({
            code: 'custom',
            path: [],
            message: 'Provide at least one field to update'
        });
    }
    checkTicketTypeBounds(value, ctx);
});
const createHoldRequestSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    ticketTypeId: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"],
    quantity: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["quantitySchema"],
    ttlSeconds: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].coerce.number().int().min(30).max(3600).optional()
});
const orderItemRequestSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    ticketTypeId: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"],
    quantity: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["quantitySchema"]
});
const createOrderRequestSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    eventId: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"],
    buyerEmail: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["emailSchema"],
    buyerName: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["nonEmptyStringSchema"],
    userId: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"].nullish(),
    items: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].array(orderItemRequestSchema).min(1, 'An order needs at least one item').max(20),
    promoCode: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["promoCodeStringSchema"].optional(),
    holdIds: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].array(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"]).max(20).optional()
}).superRefine((value, ctx)=>{
    const seen = new Set();
    value.items.forEach((item, index)=>{
        if (seen.has(item.ticketTypeId)) {
            ctx.addIssue({
                code: 'custom',
                path: [
                    'items',
                    index,
                    'ticketTypeId'
                ],
                message: 'Each ticket type may appear only once; combine the quantities instead'
            });
        }
        seen.add(item.ticketTypeId);
    });
});
const checkInRequestSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    code: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["ticketCodeSchema"],
    eventId: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"].optional(),
    checkedInAt: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["timestampSchema"].optional(),
    deviceId: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["nonEmptyStringSchema"].optional(),
    force: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].boolean().default(false)
});
const joinWaitlistRequestSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    eventId: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"],
    email: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["emailSchema"],
    quantity: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["quantitySchema"].default(1),
    userId: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"].nullish()
});
const createPromoCodeRequestSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    organizationId: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"],
    eventId: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"].nullish(),
    code: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["promoCodeStringSchema"],
    type: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$enums$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["promoTypeSchema"],
    value: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].int().min(1).max(1_000_000_000),
    maxRedemptions: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["countSchema"].nullish(),
    startsAt: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["timestampSchema"].nullish(),
    endsAt: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["timestampSchema"].nullish(),
    active: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].boolean().default(true)
}).superRefine((value, ctx)=>{
    if (value.type === 'PERCENTAGE' && value.value > 10_000) {
        ctx.addIssue({
            code: 'custom',
            path: [
                'value'
            ],
            message: 'A PERCENTAGE promo code is basis points and cannot exceed 10000 (100%)'
        });
    }
    if (value.startsAt && value.endsAt && Date.parse(value.endsAt) <= Date.parse(value.startsAt)) {
        ctx.addIssue({
            code: 'custom',
            path: [
                'endsAt'
            ],
            message: 'endsAt must be after startsAt'
        });
    }
});
const listQuerySchema = __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["paginationQuerySchema"];
const idParamSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    id: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"]
});
const slugParamSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    slug: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["slugSchema"]
});
const paymentWebhookRequestSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    provider: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().min(1).max(64),
    providerEventId: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().min(1).max(200),
    eventType: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].enum([
        'payment.succeeded',
        'payment.failed'
    ]),
    orderReference: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["orderReferenceSchema"],
    providerRef: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().min(1).max(200).optional(),
    amountCents: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["centsSchema"].optional(),
    currency: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["currencySchema"].optional(),
    failureCode: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().min(1).max(100).optional()
});
}),
"[project]/packages/schemas/src/responses.js [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "authResponseSchema",
    ()=>authResponseSchema,
    "buildPaginationMeta",
    ()=>buildPaginationMeta,
    "checkInResponseSchema",
    ()=>checkInResponseSchema,
    "errorResponseSchema",
    ()=>errorResponseSchema,
    "eventDetailResponseSchema",
    ()=>eventDetailResponseSchema,
    "eventFacetsResponseSchema",
    ()=>eventFacetsResponseSchema,
    "eventListResponseSchema",
    ()=>eventListResponseSchema,
    "healthResponseSchema",
    ()=>healthResponseSchema,
    "holdResponseSchema",
    ()=>holdResponseSchema,
    "issueResponseSchema",
    ()=>issueResponseSchema,
    "okResponseSchema",
    ()=>okResponseSchema,
    "orderResponseSchema",
    ()=>orderResponseSchema,
    "organizationResponseSchema",
    ()=>organizationResponseSchema,
    "paginationMetaSchema",
    ()=>paginationMetaSchema,
    "ticketTypeListResponseSchema",
    ()=>ticketTypeListResponseSchema,
    "venueResponseSchema",
    ()=>venueResponseSchema
]);
/**
 * Response body schemas.
 *
 * The API validates outbound payloads with these, and
 * `@desi-event/api-contract` renders them to JSON Schema for the OpenAPI
 * document — which is why nothing in this file uses `.transform()`.
 *
 * @module @desi-event/schemas/responses
 */ var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/zod@4.6.5/node_modules/zod/v4/classic/external.js [app-rsc] (ecmascript) <export * as z>");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/schemas/src/primitives.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$enums$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/schemas/src/enums.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$payments$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/schemas/src/payments.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$entities$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/schemas/src/entities.js [app-rsc] (ecmascript)");
;
;
;
;
;
const paginationMetaSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    page: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].int().min(1),
    perPage: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].int().min(1),
    total: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].int().min(0),
    totalPages: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].int().min(0),
    hasNextPage: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].boolean(),
    hasPreviousPage: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].boolean()
});
function buildPaginationMeta({ page, perPage, total }) {
    const totalPages = perPage > 0 ? Math.ceil(total / perPage) : 0;
    return {
        page,
        perPage,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1 && totalPages > 0
    };
}
const issueResponseSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    path: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string(),
    code: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string(),
    message: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string()
});
const errorResponseSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    error: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
        code: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["nonEmptyStringSchema"],
        message: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["nonEmptyStringSchema"],
        statusCode: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].int().min(100).max(599),
        issues: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].array(issueResponseSchema).optional(),
        requestId: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().min(1).max(64).optional()
    })
});
const authResponseSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    token: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().min(1),
    tokenType: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].literal('Bearer').default('Bearer'),
    expiresIn: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().min(1).default('7d'),
    user: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$entities$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["publicUserSchema"]
});
const eventListResponseSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    data: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].array(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$entities$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["eventSummarySchema"]),
    pagination: paginationMetaSchema
});
const eventDetailResponseSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    data: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$entities$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["eventWithRelationsSchema"]
});
const orderResponseSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    data: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$entities$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["orderWithItemsSchema"]
});
const ticketTypeListResponseSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    data: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].array(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$entities$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["ticketTypeSchema"].extend({
        availableQuantity: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].int().min(0).optional(),
        isSoldOut: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].boolean().optional()
    }))
});
const holdResponseSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    data: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
        id: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"],
        ticketTypeId: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"],
        quantity: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].int().min(1),
        expiresAt: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["timestampSchema"],
        unitPriceCents: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["centsSchema"].optional(),
        /**
     * Returned exactly once, when an anonymous caller takes a hold, and never
     * stored in plaintext. The caller must present it to release the hold.
     * Absent for holds owned by an authenticated user, whose identity comes
     * from their token instead.
     */ guestToken: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().min(1).optional()
    })
});
const checkInResponseSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    data: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
        ticket: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$entities$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["ticketSchema"],
        alreadyCheckedIn: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].boolean().default(false)
    })
});
const organizationResponseSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    data: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$entities$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["organizationSchema"]
});
const venueResponseSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    data: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$entities$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["venueSchema"]
});
const healthResponseSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    status: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].enum([
        'ok',
        'degraded',
        'error'
    ]),
    uptimeSeconds: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].number().min(0).optional(),
    version: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().min(1).max(32).optional(),
    logLevel: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$enums$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["logLevelSchema"].optional(),
    timestamp: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["timestampSchema"],
    checks: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
        database: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].boolean(),
        redis: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].boolean()
    }).partial().optional(),
    /**
   * What this instance can do with money.
   *
   * There is one payment mode and it moves no money. Reporting it on the
   * liveness probe means an operator never has to read the source to find out
   * whether a deployment can charge a card: it cannot, and it says so.
   */ payments: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
        mode: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].enum([
            __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$payments$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["PAYMENT_MODES"].MOCK,
            __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$payments$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["PAYMENT_MODES"].STRIPE_TEST
        ]),
        demo: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].literal(true),
        live: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].literal(false).optional(),
        label: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().min(1).max(16).optional(),
        message: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().min(1).max(200)
    }).optional()
});
const okResponseSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    ok: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].literal(true)
});
const eventFacetsResponseSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    data: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
        /** The query scope these counts were computed over. */ scope: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
            status: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string(),
            total: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["countSchema"]
        }),
        categories: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].array(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
            value: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$enums$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["eventCategorySchema"],
            count: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["countSchema"]
        })),
        cities: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].array(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
            value: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string(),
            count: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["countSchema"]
        })),
        languages: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].array(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
            value: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string(),
            count: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["countSchema"]
        })),
        formats: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].array(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
            value: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].enum([
                'online',
                'in_person'
            ]),
            count: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["countSchema"]
        }))
    })
});
}),
"[project]/packages/schemas/src/seating.js [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "holdSeatsRequestSchema",
    ()=>holdSeatsRequestSchema,
    "publicSeatSchema",
    ()=>publicSeatSchema,
    "seatHoldResponseSchema",
    ()=>seatHoldResponseSchema,
    "seatMapResponseSchema",
    ()=>seatMapResponseSchema,
    "seatRowSchema",
    ()=>seatRowSchema,
    "seatSectionSchema",
    ()=>seatSectionSchema
]);
/**
 * Seat maps and seat holds, over the wire.
 *
 * Two response shapes and one request. What the request does *not* accept is the
 * point: no price, no status, no hold duration, no ticket-type override. A buyer
 * names seats and a session; everything else about what those seats cost and
 * whether they may have them is decided server-side from rows they cannot touch.
 *
 * @module @desi-event/schemas/seating
 */ var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/zod@4.6.5/node_modules/zod/v4/classic/external.js [app-rsc] (ecmascript) <export * as z>");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$enums$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/schemas/src/enums.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/schemas/src/primitives.js [app-rsc] (ecmascript)");
;
;
;
const publicSeatSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    id: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"],
    seatId: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"],
    label: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["nonEmptyStringSchema"],
    sectionId: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"],
    rowId: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"].nullish(),
    priceZoneId: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"].nullish(),
    sortOrder: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].int(),
    available: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].boolean(),
    accessible: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].boolean(),
    companionOfSeatId: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"].nullish(),
    obstructedView: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].boolean(),
    restricted: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].boolean(),
    restrictionNote: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().max(500).nullish(),
    priceCents: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["centsSchema"].nullish(),
    ticketTypeId: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"].nullish(),
    status: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$enums$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["eventSeatStatusSchema"].optional(),
    blockedReason: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().max(500).nullish()
});
const seatRowSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    id: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"],
    label: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["nonEmptyStringSchema"],
    sortOrder: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].int(),
    seats: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].array(publicSeatSchema)
});
const seatSectionSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    id: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"],
    name: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["nonEmptyStringSchema"],
    kind: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$enums$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["sectionKindSchema"],
    sortOrder: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].int(),
    standingCapacity: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].int().nullish(),
    rows: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].array(seatRowSchema),
    seats: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].array(publicSeatSchema)
});
const seatMapResponseSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    data: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
        sessionId: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"],
        eventId: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"],
        venueMapVersionId: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"].nullish(),
        startsAt: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["timestampSchema"],
        endsAt: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["timestampSchema"],
        timezone: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["nonEmptyStringSchema"],
        counts: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
            total: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].int().min(0),
            available: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].int().min(0),
            held: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].int().min(0),
            sold: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].int().min(0),
            unavailable: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].int().min(0)
        }),
        sections: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].array(seatSectionSchema)
    })
});
const holdSeatsRequestSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    seatIds: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].array(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"]).min(1).max(20)
});
const seatHoldResponseSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    data: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
        id: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"],
        eventSessionId: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"],
        expiresAt: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["timestampSchema"],
        // Returned once, to a guest who has no account to own the hold with. An
        // authenticated buyer gets no token: their session is the ownership proof.
        guestToken: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().min(16).nullish(),
        seats: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].array(publicSeatSchema),
        subtotalCents: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["centsSchema"],
        currency: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().length(3)
    })
});
}),
"[project]/packages/schemas/src/teams.js [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "acceptInvitationRequestSchema",
    ()=>acceptInvitationRequestSchema,
    "acceptedInvitationResponseSchema",
    ()=>acceptedInvitationResponseSchema,
    "assignableOrgRoleSchema",
    ()=>assignableOrgRoleSchema,
    "invitationResponseSchema",
    ()=>invitationResponseSchema,
    "invitationSummarySchema",
    ()=>invitationSummarySchema,
    "inviteMemberRequestSchema",
    ()=>inviteMemberRequestSchema,
    "memberListResponseSchema",
    ()=>memberListResponseSchema,
    "memberSummarySchema",
    ()=>memberSummarySchema,
    "removeMemberRequestSchema",
    ()=>removeMemberRequestSchema,
    "updateMemberRequestSchema",
    ()=>updateMemberRequestSchema
]);
/**
 * Team management: who is in an organisation, and how they got there.
 *
 * The shapes are small; the rules they carry are not, and every one of them
 * exists because of a specific way this goes wrong:
 *
 *   - An invitation names a **role**, and the role a member may grant is bounded
 *     by what they themselves hold. Without that, a `MANAGER` invites somebody as
 *     `OWNER` and then asks them for the keys.
 *   - An invitation is addressed to an **email**, and accepting it requires being
 *     signed in as that address. Without that, a link forwarded to a colleague
 *     puts the wrong person in the organisation.
 *   - A member's role can be changed and their membership removed, and both are
 *     bounded the same way, plus one more: the last `OWNER` cannot be demoted or
 *     removed. An organisation with no owner is an organisation nobody can fix.
 *
 * @module @desi-event/schemas/teams
 */ var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/zod@4.6.5/node_modules/zod/v4/classic/external.js [app-rsc] (ecmascript) <export * as z>");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$enums$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/schemas/src/enums.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/schemas/src/primitives.js [app-rsc] (ecmascript)");
;
;
;
const assignableOrgRoleSchema = __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$enums$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["orgRoleSchema"].exclude([
    'OWNER'
]);
const inviteMemberRequestSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    email: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["emailSchema"],
    role: assignableOrgRoleSchema,
    // Only meaningful for SCANNER, whose authority is "admit this ticket" in the
    // events it is scoped to and nothing else. Empty for every other role.
    eventIds: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].array(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"]).max(200).optional()
});
const acceptInvitationRequestSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    token: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().min(16).max(512).regex(/^[A-Za-z0-9_-]+$/, 'Expected a url-safe token')
});
const updateMemberRequestSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    role: assignableOrgRoleSchema,
    eventIds: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].array(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"]).max(200).optional()
});
const removeMemberRequestSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    reason: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].preprocess((value)=>typeof value === 'string' ? value.trim() : value, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().min(1).max(200)).optional()
});
const memberSummarySchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    id: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"],
    userId: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"],
    email: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["emailSchema"],
    displayName: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["nonEmptyStringSchema"],
    role: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$enums$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["orgRoleSchema"],
    capabilities: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].array(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().min(1)),
    scopedEventIds: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].array(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"]),
    joinedAt: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["timestampSchema"],
    // True for the caller's own membership, so a UI can grey out the controls
    // that would remove them from their own organisation.
    self: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].boolean()
});
const invitationSummarySchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    id: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"],
    email: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["emailSchema"],
    role: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$enums$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["orgRoleSchema"],
    status: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().min(1),
    invitedByName: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["nonEmptyStringSchema"].nullish(),
    expiresAt: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["timestampSchema"],
    createdAt: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["timestampSchema"]
});
const memberListResponseSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    data: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
        members: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].array(memberSummarySchema),
        invitations: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].array(invitationSummarySchema),
        // The roles this caller may grant, computed from what they hold. A UI that
        // renders the full list and lets the server refuse is a UI that teaches
        // people the product is broken.
        assignableRoles: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].array(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$enums$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["orgRoleSchema"])
    })
});
const invitationResponseSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    data: invitationSummarySchema
});
const acceptedInvitationResponseSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    data: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
        organizationId: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"],
        organizationName: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["nonEmptyStringSchema"],
        role: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$enums$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["orgRoleSchema"]
    })
});
}),
"[project]/packages/schemas/src/verification.js [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "moderateVerificationRequestSchema",
    ()=>moderateVerificationRequestSchema,
    "moderationDecisionSchema",
    ()=>moderationDecisionSchema,
    "organizerSlugParamSchema",
    ()=>organizerSlugParamSchema,
    "publicOrganizerResponseSchema",
    ()=>publicOrganizerResponseSchema,
    "publicOrganizerSchema",
    ()=>publicOrganizerSchema,
    "submitVerificationRequestSchema",
    ()=>submitVerificationRequestSchema,
    "verificationEventSchema",
    ()=>verificationEventSchema,
    "verificationReasonSchema",
    ()=>verificationReasonSchema,
    "verificationStateResponseSchema",
    ()=>verificationStateResponseSchema,
    "verificationStateSchema",
    ()=>verificationStateSchema
]);
/**
 * Organiser verification: what an organiser may ask for, and what a moderator
 * may decide.
 *
 * The shapes are deliberately asymmetric, and the asymmetry is the
 * authorisation model written down:
 *
 *   - An organiser **submits**. They do not name a target state, because the
 *     only state they can reach is `PENDING` and offering a field implies a
 *     choice they do not have.
 *   - A moderator **decides**, naming one of four outcomes and a reason. The
 *     reason is required rather than optional: a verification decision with no
 *     recorded rationale is one nobody can review, appeal or learn from.
 *
 * Nothing here accepts a bank detail, a tax identifier or a document. Those
 * belong with the payment provider, which is licensed to hold them; this
 * endpoint holds the *decision*, not the evidence.
 *
 * @module @desi-event/schemas/verification
 */ var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/zod@4.6.5/node_modules/zod/v4/classic/external.js [app-rsc] (ecmascript) <export * as z>");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$enums$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/schemas/src/enums.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/schemas/src/primitives.js [app-rsc] (ecmascript)");
;
;
;
const verificationReasonSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().trim().min(3).max(500);
const moderationDecisionSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].enum([
    'REQUIRES_INFORMATION',
    'VERIFIED',
    'REJECTED',
    'SUSPENDED',
    'REVOKED'
]);
const submitVerificationRequestSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    /** The registered legal name, when it differs from the trading name. */ legalName: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["nonEmptyStringSchema"].optional(),
    /** What the organiser wants a moderator to know. Never a document. */ note: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().trim().max(1000).optional()
});
const moderateVerificationRequestSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    decision: moderationDecisionSchema,
    reason: verificationReasonSchema,
    /**
     * What the organiser must supply. Only meaningful alongside
     * `REQUIRES_INFORMATION`, and required there: asking for information without
     * saying which information is a round trip wasted.
     */ note: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().trim().max(1000).optional()
}).refine((value)=>value.decision !== 'REQUIRES_INFORMATION' || Boolean(value.note), {
    message: 'Say what the organiser needs to supply.',
    path: [
        'note'
    ]
});
const verificationEventSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    id: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"],
    fromStatus: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$enums$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["verificationStatusSchema"].nullable(),
    toStatus: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$enums$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["verificationStatusSchema"],
    reason: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().nullable(),
    createdAt: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["timestampSchema"]
});
const verificationStateSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    organizationId: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cuidSchema"],
    status: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$enums$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["verificationStatusSchema"],
    /**
   * Whether the organisation may publish and be paid.
   *
   * Sent as its own field rather than left for the client to derive from
   * `status`, so that a screen cannot get the rule subtly wrong — and so the
   * rule can change without every client changing with it.
   */ eligible: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].boolean(),
    note: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().nullable(),
    updatedAt: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["timestampSchema"].nullable(),
    history: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].array(verificationEventSchema)
});
const verificationStateResponseSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    data: verificationStateSchema
});
const publicOrganizerSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    slug: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string(),
    name: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string(),
    description: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().nullable(),
    websiteUrl: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().nullable(),
    /**
   * Shown only for a genuinely verified organisation.
   *
   * Derived server-side from the verification state rather than from the
   * denormalised column, so a stale badge cannot be served.
   */ verified: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].boolean(),
    refundPolicy: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().nullable(),
    timezone: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string(),
    upcomingEvents: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].array(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
        slug: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string(),
        title: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string(),
        startsAt: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["timestampSchema"],
        venueName: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().nullable()
    })),
    pastEvents: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].array(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
        slug: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string(),
        title: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string(),
        startsAt: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$schemas$2f$src$2f$primitives$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["timestampSchema"],
        venueName: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().nullable()
    }))
});
const publicOrganizerResponseSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    data: publicOrganizerSchema
});
const organizerSlugParamSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    slug: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$zod$40$4$2e$6$2e$5$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().min(1).max(120)
});
}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__1ehzazq._.js.map