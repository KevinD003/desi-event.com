module.exports = [
"[project]/apps/web/src/components/listing-filters.jsx [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "EventFilters",
    ()=>EventFilters
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@16.3.5_@playwright+test@1.63.0_@types+node@26.5.1_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react-jsx-dev-runtime.js [app-ssr] (ecmascript)");
/**
 * The listing's filter bar.
 *
 * This is a real `<form method="get" action="/events">`. With JavaScript
 * disabled, or before hydration finishes, submitting it navigates to exactly
 * the URL the enhanced version would have produced — the filter state lives in
 * the query string either way. Hydration only adds two conveniences: the
 * selects apply themselves on change instead of waiting for a submit, and the
 * navigation is client-side.
 *
 * The form is uncontrolled: the server passes the current filters as
 * `defaultValue`s and the browser's own form state is the source of truth
 * between navigations.
 *
 * It is deliberately NOT remounted when the filters change. It used to be —
 * the parent gave it a `key` derived from the filter values — which meant every
 * change destroyed and rebuilt the form, throwing keyboard focus back to the
 * document body in the middle of the interaction. A keyboard or screen-reader
 * user who changed the category select was dropped at the top of the page with
 * no idea what had happened. Reconciling in place keeps focus where the visitor
 * put it, and a polite live region tells them what changed instead of moving
 * them.
 *
 * @module components/listing-filters
 */ var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@16.3.5_@playwright+test@1.63.0_@types+node@26.5.1_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$navigation$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@16.3.5_@playwright+test@1.63.0_@types+node@26.5.1_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/next/navigation.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$components$2f$ui$2e$jsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/apps/web/src/components/ui.jsx [app-ssr] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$Button$2e$jsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/ui/src/Button.jsx [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$FormField$2e$jsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/ui/src/FormField.jsx [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$Input$2e$jsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/ui/src/Input.jsx [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$Select$2e$jsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/ui/src/Select.jsx [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$search$2d$params$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/src/lib/search-params.js [app-ssr] (ecmascript)");
'use client';
;
;
;
;
;
/**
 * @typedef {object} EventFiltersProps
 * @property {Array<{value: string, label: string}>} categories Categories offered in the select.
 * @property {string[]} cities Cities offered in the select.
 * @property {object} filters Current filter state, used for the initial values.
 * @property {boolean} [anyActive] Whether to offer the "clear filters" control.
 * @property {number} [resultCount] How many events match, announced politely when it changes.
 */ /**
 * Read the filter values out of a form element.
 *
 * @param {HTMLFormElement} form The filter form.
 * @returns {{category: string, city: string, q: string}} The current selection.
 */ function readFilters(form) {
    const data = new FormData(form);
    return {
        category: String(data.get('category') ?? ''),
        city: String(data.get('city') ?? ''),
        q: String(data.get('q') ?? '').trim()
    };
}
function EventFilters({ categories, cities, filters, anyActive = false, resultCount }) {
    const router = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$navigation$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRouter"])();
    const formRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(null);
    // Announced rather than focused. Moving focus on every filter change is its
    // own accessibility problem: it interrupts whatever the visitor was doing.
    // The count is held in state and only published after the first render so a
    // screen reader announces the *change*, not the initial page content it is
    // already reading.
    const [announcement, setAnnouncement] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])('');
    const announced = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(false);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        if (!announced.current) {
            announced.current = true;
            return;
        }
        if (typeof resultCount !== 'number') return;
        setAnnouncement(resultCount === 1 ? '1 event matches your filters' : `${resultCount} events match your filters`);
    }, [
        resultCount
    ]);
    /**
   * Navigate to the listing URL described by the form's current values.
   *
   * @returns {void}
   */ function applyFilters() {
        if (!formRef.current) return;
        router.push((0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$search$2d$params$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["buildEventsHref"])(readFilters(formRef.current)));
    }
    /**
   * Handle the form's submit event without a full page load.
   *
   * @param {SubmitEvent} event The submit event.
   * @returns {void}
   */ function handleSubmit(event) {
        event.preventDefault();
        applyFilters();
    }
    /**
   * Clear every filter, resetting the form's own state as well as the URL.
   *
   * The form is uncontrolled and no longer remounts, so its DOM values have to
   * be cleared explicitly — otherwise the inputs would keep showing filters
   * that are no longer applied.
   *
   * @returns {void}
   */ function clearFilters() {
        formRef.current?.reset();
        for (const field of formRef.current?.elements ?? []){
            if (field.name === 'category' || field.name === 'city' || field.name === 'q') {
                field.value = '';
            }
        }
        router.push('/events');
    }
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("form", {
        ref: formRef,
        action: "/events",
        method: "get",
        onSubmit: handleSubmit,
        "aria-label": "Filter events",
        className: "grid grid-cols-1 gap-4 rounded-card border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_2fr_auto] lg:items-end",
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$FormField$2e$jsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["FormField"], {
                label: "Category",
                id: "filter-category",
                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$Select$2e$jsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["Select"], {
                    name: "category",
                    defaultValue: filters.category ?? '',
                    onChange: applyFilters,
                    options: [
                        {
                            value: '',
                            label: 'All categories'
                        },
                        ...categories.map((category)=>({
                                value: category.value,
                                label: category.label
                            }))
                    ]
                }, void 0, false, {
                    fileName: "[project]/apps/web/src/components/listing-filters.jsx",
                    lineNumber: 145,
                    columnNumber: 9
                }, this)
            }, void 0, false, {
                fileName: "[project]/apps/web/src/components/listing-filters.jsx",
                lineNumber: 144,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$FormField$2e$jsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["FormField"], {
                label: "City",
                id: "filter-city",
                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$Select$2e$jsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["Select"], {
                    name: "city",
                    defaultValue: filters.city ?? '',
                    onChange: applyFilters,
                    options: [
                        {
                            value: '',
                            label: 'Every city'
                        },
                        ...cities.map((city)=>({
                                value: city,
                                label: city
                            }))
                    ]
                }, void 0, false, {
                    fileName: "[project]/apps/web/src/components/listing-filters.jsx",
                    lineNumber: 157,
                    columnNumber: 9
                }, this)
            }, void 0, false, {
                fileName: "[project]/apps/web/src/components/listing-filters.jsx",
                lineNumber: 156,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$FormField$2e$jsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["FormField"], {
                label: "Search",
                id: "filter-q",
                description: "Try an artist, a venue or something like “garba toronto”.",
                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$Input$2e$jsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["Input"], {
                    type: "search",
                    name: "q",
                    defaultValue: filters.q ?? '',
                    placeholder: "Search events",
                    autoComplete: "off"
                }, void 0, false, {
                    fileName: "[project]/apps/web/src/components/listing-filters.jsx",
                    lineNumber: 173,
                    columnNumber: 9
                }, this)
            }, void 0, false, {
                fileName: "[project]/apps/web/src/components/listing-filters.jsx",
                lineNumber: 168,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                role: "status",
                "aria-live": "polite",
                "aria-atomic": "true",
                className: "sr-only",
                children: announcement
            }, void 0, false, {
                fileName: "[project]/apps/web/src/components/listing-filters.jsx",
                lineNumber: 186,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "flex items-center gap-2",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$Button$2e$jsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["Button"], {
                        type: "submit",
                        children: "Apply"
                    }, void 0, false, {
                        fileName: "[project]/apps/web/src/components/listing-filters.jsx",
                        lineNumber: 191,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("a", {
                        href: "#event-results",
                        className: "rounded-lg px-3 py-2 text-sm font-medium text-indigo-night-700 underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marigold-500",
                        children: "Skip to results"
                    }, void 0, false, {
                        fileName: "[project]/apps/web/src/components/listing-filters.jsx",
                        lineNumber: 197,
                        columnNumber: 9
                    }, this),
                    anyActive ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$Button$2e$jsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["Button"], {
                        type: "button",
                        variant: "ghost",
                        onClick: clearFilters,
                        children: "Clear"
                    }, void 0, false, {
                        fileName: "[project]/apps/web/src/components/listing-filters.jsx",
                        lineNumber: 204,
                        columnNumber: 11
                    }, this) : null
                ]
            }, void 0, true, {
                fileName: "[project]/apps/web/src/components/listing-filters.jsx",
                lineNumber: 190,
                columnNumber: 7
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/apps/web/src/components/listing-filters.jsx",
        lineNumber: 136,
        columnNumber: 5
    }, this);
}
}),
"[project]/apps/web/src/components/motion.jsx [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "FadeIn",
    ()=>FadeIn,
    "HoverLift",
    ()=>HoverLift,
    "RevealOnScroll",
    ()=>RevealOnScroll
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@16.3.5_@playwright+test@1.63.0_@types+node@26.5.1_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react-jsx-dev-runtime.js [app-ssr] (ecmascript)");
/**
 * Motion primitives.
 *
 * Every animation on the site goes through one of these three components, for
 * one reason: `useReducedMotion` is consulted in exactly one place and cannot
 * be forgotten. When the visitor's platform asks for reduced motion, these
 * render the plain element in its final state — no transform, no fade, no
 * transition — rather than a faster version of the same movement. Vestibular
 * disorders are not helped by a shorter slide.
 *
 * Every element rendered here carries a `data-motion` attribute, and that is
 * load-bearing rather than decorative. The server cannot know the visitor's
 * motion preference, so it renders the animated branch and inlines
 * `opacity: 0`. A visitor who prefers reduced motion then hydrates into the
 * plain branch, which sets no style at all — and React does not strip the
 * inline style the server already wrote. The content stays invisible forever.
 *
 * `data-motion` gives `globals.css` something to target, so the final state is
 * forced in CSS under `prefers-reduced-motion: reduce` and inside `noscript`.
 * CSS is the only layer here that cannot disagree with the server.
 *
 * @module components/motion
 */ var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$framer$2d$motion$40$13$2e$3$2e$0_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$framer$2d$motion$2f$dist$2f$es$2f$render$2f$components$2f$motion$2f$proxy$2e$mjs__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/framer-motion@13.3.0_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/framer-motion/dist/es/render/components/motion/proxy.mjs [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$framer$2d$motion$40$13$2e$3$2e$0_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$framer$2d$motion$2f$dist$2f$es$2f$utils$2f$reduced$2d$motion$2f$use$2d$reduced$2d$motion$2e$mjs__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/framer-motion@13.3.0_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/framer-motion/dist/es/utils/reduced-motion/use-reduced-motion.mjs [app-ssr] (ecmascript)");
'use client';
;
;
/** Deceleration curve used for every entrance, so the site moves consistently. */ const EASE_OUT = [
    0.22,
    1,
    0.36,
    1
];
/** Seconds added per position in a staggered group. */ const STAGGER_STEP = 0.06;
function FadeIn({ as = 'div', delay = 0, index = 0, distance = 14, className, children, ...rest }) {
    const prefersReducedMotion = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$framer$2d$motion$40$13$2e$3$2e$0_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$framer$2d$motion$2f$dist$2f$es$2f$utils$2f$reduced$2d$motion$2f$use$2d$reduced$2d$motion$2e$mjs__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useReducedMotion"])();
    const Component = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$framer$2d$motion$40$13$2e$3$2e$0_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$framer$2d$motion$2f$dist$2f$es$2f$render$2f$components$2f$motion$2f$proxy$2e$mjs__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["motion"][as] ?? __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$framer$2d$motion$40$13$2e$3$2e$0_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$framer$2d$motion$2f$dist$2f$es$2f$render$2f$components$2f$motion$2f$proxy$2e$mjs__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["motion"].div;
    if (prefersReducedMotion) {
        return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(Component, {
            className: className,
            "data-motion": "",
            ...rest,
            children: children
        }, void 0, false, {
            fileName: "[project]/apps/web/src/components/motion.jsx",
            lineNumber: 67,
            columnNumber: 7
        }, this);
    }
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(Component, {
        className: className,
        "data-motion": "",
        initial: {
            opacity: 0,
            y: distance
        },
        animate: {
            opacity: 1,
            y: 0
        },
        transition: {
            duration: 0.5,
            ease: EASE_OUT,
            delay: delay + index * STAGGER_STEP
        },
        ...rest,
        children: children
    }, void 0, false, {
        fileName: "[project]/apps/web/src/components/motion.jsx",
        lineNumber: 74,
        columnNumber: 5
    }, this);
}
function RevealOnScroll({ as = 'div', delay = 0, index = 0, distance = 18, className, children, ...rest }) {
    const prefersReducedMotion = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$framer$2d$motion$40$13$2e$3$2e$0_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$framer$2d$motion$2f$dist$2f$es$2f$utils$2f$reduced$2d$motion$2f$use$2d$reduced$2d$motion$2e$mjs__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useReducedMotion"])();
    const Component = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$framer$2d$motion$40$13$2e$3$2e$0_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$framer$2d$motion$2f$dist$2f$es$2f$render$2f$components$2f$motion$2f$proxy$2e$mjs__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["motion"][as] ?? __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$framer$2d$motion$40$13$2e$3$2e$0_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$framer$2d$motion$2f$dist$2f$es$2f$render$2f$components$2f$motion$2f$proxy$2e$mjs__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["motion"].div;
    if (prefersReducedMotion) {
        return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(Component, {
            className: className,
            "data-motion": "",
            ...rest,
            children: children
        }, void 0, false, {
            fileName: "[project]/apps/web/src/components/motion.jsx",
            lineNumber: 110,
            columnNumber: 7
        }, this);
    }
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(Component, {
        className: className,
        "data-motion": "",
        initial: {
            opacity: 0,
            y: distance
        },
        whileInView: {
            opacity: 1,
            y: 0
        },
        viewport: {
            once: true,
            amount: 0.15
        },
        transition: {
            duration: 0.45,
            ease: EASE_OUT,
            delay: delay + index * STAGGER_STEP
        },
        ...rest,
        children: children
    }, void 0, false, {
        fileName: "[project]/apps/web/src/components/motion.jsx",
        lineNumber: 117,
        columnNumber: 5
    }, this);
}
function HoverLift({ as = 'div', className, children, ...rest }) {
    const prefersReducedMotion = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$framer$2d$motion$40$13$2e$3$2e$0_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$framer$2d$motion$2f$dist$2f$es$2f$utils$2f$reduced$2d$motion$2f$use$2d$reduced$2d$motion$2e$mjs__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useReducedMotion"])();
    const Component = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$framer$2d$motion$40$13$2e$3$2e$0_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$framer$2d$motion$2f$dist$2f$es$2f$render$2f$components$2f$motion$2f$proxy$2e$mjs__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["motion"][as] ?? __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$framer$2d$motion$40$13$2e$3$2e$0_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$framer$2d$motion$2f$dist$2f$es$2f$render$2f$components$2f$motion$2f$proxy$2e$mjs__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["motion"].div;
    if (prefersReducedMotion) {
        return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(Component, {
            className: className,
            "data-motion": "",
            ...rest,
            children: children
        }, void 0, false, {
            fileName: "[project]/apps/web/src/components/motion.jsx",
            lineNumber: 146,
            columnNumber: 7
        }, this);
    }
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(Component, {
        className: className,
        "data-motion": "",
        whileHover: {
            y: -4
        },
        transition: {
            type: 'spring',
            stiffness: 320,
            damping: 26
        },
        ...rest,
        children: children
    }, void 0, false, {
        fileName: "[project]/apps/web/src/components/motion.jsx",
        lineNumber: 153,
        columnNumber: 5
    }, this);
}
}),
"[project]/apps/web/src/components/ui.jsx [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "Alert",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$Alert$2e$jsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["Alert"],
    "Badge",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$Badge$2e$jsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["Badge"],
    "Button",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$Button$2e$jsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["Button"],
    "Card",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$Card$2e$jsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["Card"],
    "CardBody",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$Card$2e$jsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["CardBody"],
    "CardFooter",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$Card$2e$jsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["CardFooter"],
    "CardHeader",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$Card$2e$jsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["CardHeader"],
    "EmptyState",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$EmptyState$2e$jsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["EmptyState"],
    "FormField",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$FormField$2e$jsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["FormField"],
    "Input",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$Input$2e$jsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["Input"],
    "Select",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$Select$2e$jsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["Select"]
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$components$2f$ui$2e$jsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/apps/web/src/components/ui.jsx [app-ssr] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$Alert$2e$jsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/ui/src/Alert.jsx [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$Badge$2e$jsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/ui/src/Badge.jsx [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$Button$2e$jsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/ui/src/Button.jsx [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$Card$2e$jsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/ui/src/Card.jsx [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$EmptyState$2e$jsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/ui/src/EmptyState.jsx [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$FormField$2e$jsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/ui/src/FormField.jsx [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$Input$2e$jsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/ui/src/Input.jsx [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$Select$2e$jsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/ui/src/Select.jsx [app-ssr] (ecmascript)");
}),
"[project]/apps/web/src/components/ui.jsx [app-ssr] (ecmascript) <locals>", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([]);
/**
 * The application's client boundary for `@desi-event/ui`.
 *
 * The component library is framework-agnostic: it ships plain React and does
 * not declare `'use client'` anywhere, which is the right call for a package
 * that has to work outside Next.js too. But its entry point is a barrel, and
 * three of the components behind that barrel (`Modal`, `Tabs`, `FormField`)
 * use hooks — so importing *anything* from it into a Server Component drags
 * `useState` into the server graph and the build fails. The package's
 * `exports` map offers no subpath, so deep-importing a single file is not an
 * option either.
 *
 * Declaring the boundary here, once, is the fix: the primitives this app uses
 * are re-exported from a module that is explicitly a client module. Pages and
 * layouts stay Server Components and simply pass props and children across the
 * boundary, which is exactly what the boundary is for. The cost is that these
 * presentational leaves are hydrated on the client; the alternative is
 * reimplementing them, which would be worse.
 *
 * @module components/ui
 */ var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$index$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/packages/ui/src/index.js [app-ssr] (ecmascript) <locals>");
'use client';
;
}),
"[project]/apps/web/src/lib/catalog.js [app-ssr] (ecmascript)", ((__turbopack_context__) => {
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
"[project]/apps/web/src/lib/search-params.js [app-ssr] (ecmascript)", ((__turbopack_context__) => {
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
 */ var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$catalog$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/src/lib/catalog.js [app-ssr] (ecmascript)");
;
const DEFAULT_PER_PAGE = 12;
/** Largest page size a URL may ask for, mirroring the API's own cap. */ const MAX_PER_PAGE = 48;
/** Category values the listing will accept from a URL. */ const KNOWN_CATEGORIES = new Set(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$catalog$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["EVENT_CATEGORIES"].map((category)=>category.value));
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
"[project]/packages/ui/src/Alert.jsx [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "Alert",
    ()=>Alert,
    "default",
    ()=>__TURBOPACK__default__export__
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@16.3.5_@playwright+test@1.63.0_@types+node@26.5.1_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react-jsx-dev-runtime.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$cn$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/ui/src/cn.js [app-ssr] (ecmascript)");
;
;
/** Tailwind classes per alert variant. */ const ALERT_VARIANTS = {
    info: 'border-indigo-night-100 bg-indigo-night-50 text-indigo-night-900',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
    error: 'border-rose-200 bg-rose-50 text-rose-900'
};
/**
 * Variants that interrupt the user. `role="alert"` is assertive and preempts
 * whatever the screen reader is saying, which is right for a failure and wrong
 * for "saved".
 */ const URGENT_VARIANTS = new Set([
    'warning',
    'error'
]);
function Alert({ variant = 'info', title, onDismiss, dismissLabel = 'Dismiss', className, children, ...rest }) {
    const urgent = URGENT_VARIANTS.has(variant);
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        role: urgent ? 'alert' : 'status',
        "aria-live": urgent ? 'assertive' : 'polite',
        "data-slot": "alert",
        "data-variant": variant,
        className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$cn$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["cn"])('flex items-start gap-3 rounded-lg border px-4 py-3 text-sm', ALERT_VARIANTS[variant] ?? ALERT_VARIANTS.info, className),
        ...rest,
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "flex-1",
                children: [
                    title ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                        className: "font-semibold",
                        children: title
                    }, void 0, false, {
                        fileName: "[project]/packages/ui/src/Alert.jsx",
                        lineNumber: 63,
                        columnNumber: 18
                    }, this) : null,
                    children ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$cn$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["cn"])(title && 'mt-1'),
                        children: children
                    }, void 0, false, {
                        fileName: "[project]/packages/ui/src/Alert.jsx",
                        lineNumber: 64,
                        columnNumber: 21
                    }, this) : null
                ]
            }, void 0, true, {
                fileName: "[project]/packages/ui/src/Alert.jsx",
                lineNumber: 62,
                columnNumber: 7
            }, this),
            onDismiss ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("button", {
                type: "button",
                onClick: onDismiss,
                className: "-mr-1 rounded p-1 leading-none text-current/70 hover:text-current focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                        "aria-hidden": "true",
                        children: "×"
                    }, void 0, false, {
                        fileName: "[project]/packages/ui/src/Alert.jsx",
                        lineNumber: 72,
                        columnNumber: 11
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                        className: "sr-only",
                        children: dismissLabel
                    }, void 0, false, {
                        fileName: "[project]/packages/ui/src/Alert.jsx",
                        lineNumber: 73,
                        columnNumber: 11
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/packages/ui/src/Alert.jsx",
                lineNumber: 67,
                columnNumber: 9
            }, this) : null
        ]
    }, void 0, true, {
        fileName: "[project]/packages/ui/src/Alert.jsx",
        lineNumber: 50,
        columnNumber: 5
    }, this);
}
const __TURBOPACK__default__export__ = Alert;
}),
"[project]/packages/ui/src/Badge.jsx [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "Badge",
    ()=>Badge,
    "default",
    ()=>__TURBOPACK__default__export__
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@16.3.5_@playwright+test@1.63.0_@types+node@26.5.1_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react-jsx-dev-runtime.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$cn$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/ui/src/cn.js [app-ssr] (ecmascript)");
;
;
/** Tailwind classes per badge variant. */ const BADGE_VARIANTS = {
    neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
    brand: 'bg-marigold-100 text-marigold-900 ring-marigold-200',
    success: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
    warning: 'bg-amber-100 text-amber-900 ring-amber-200',
    danger: 'bg-rose-100 text-rose-800 ring-rose-200',
    info: 'bg-indigo-night-100 text-indigo-night-900 ring-indigo-night-100'
};
/** Tailwind classes per badge size. */ const BADGE_SIZES = {
    sm: 'px-1.5 py-0.5 text-[0.6875rem]',
    md: 'px-2 py-0.5 text-xs',
    lg: 'px-2.5 py-1 text-sm'
};
function Badge({ variant = 'neutral', size = 'md', srLabel, className, children, ...rest }) {
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
        "data-slot": "badge",
        "data-variant": variant,
        className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$cn$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["cn"])('inline-flex items-center gap-1 rounded-full font-medium ring-1 ring-inset whitespace-nowrap', BADGE_VARIANTS[variant] ?? BADGE_VARIANTS.neutral, BADGE_SIZES[size] ?? BADGE_SIZES.md, className),
        ...rest,
        children: [
            srLabel ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                className: "sr-only",
                children: [
                    srLabel,
                    " "
                ]
            }, void 0, true, {
                fileName: "[project]/packages/ui/src/Badge.jsx",
                lineNumber: 48,
                columnNumber: 18
            }, this) : null,
            children
        ]
    }, void 0, true, {
        fileName: "[project]/packages/ui/src/Badge.jsx",
        lineNumber: 37,
        columnNumber: 5
    }, this);
}
const __TURBOPACK__default__export__ = Badge;
}),
"[project]/packages/ui/src/Button.jsx [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "Button",
    ()=>Button,
    "default",
    ()=>__TURBOPACK__default__export__
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@16.3.5_@playwright+test@1.63.0_@types+node@26.5.1_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react-jsx-dev-runtime.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$cn$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/ui/src/cn.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$Spinner$2e$jsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/ui/src/Spinner.jsx [app-ssr] (ecmascript)");
;
;
;
/** Tailwind classes per button variant. */ const BUTTON_VARIANTS = {
    primary: 'bg-marigold-600 text-white shadow-sm hover:bg-marigold-700 focus-visible:ring-marigold-500',
    secondary: 'bg-indigo-night-700 text-white shadow-sm hover:bg-indigo-night-900 focus-visible:ring-indigo-night-500',
    outline: 'border border-slate-300 bg-white text-slate-900 hover:bg-slate-50 focus-visible:ring-marigold-500',
    ghost: 'bg-transparent text-slate-700 hover:bg-slate-100 focus-visible:ring-slate-400',
    danger: 'bg-rose-600 text-white shadow-sm hover:bg-rose-700 focus-visible:ring-rose-500'
};
/** Tailwind classes per button size. */ const BUTTON_SIZES = {
    sm: 'h-8 gap-1.5 px-3 text-sm',
    md: 'h-10 gap-2 px-4 text-sm',
    lg: 'h-12 gap-2 px-6 text-base'
};
/** Spinner size that reads well inside each button size. */ const SPINNER_FOR_SIZE = {
    sm: 'xs',
    md: 'sm',
    lg: 'md'
};
function Button({ variant = 'primary', size = 'md', loading = false, disabled = false, fullWidth = false, type = 'button', className, children, ref, ...rest }) {
    const isDisabled = disabled || loading;
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("button", {
        ref: ref,
        type: type,
        disabled: isDisabled,
        "aria-busy": loading || undefined,
        "data-slot": "button",
        "data-variant": variant,
        "data-loading": loading ? 'true' : undefined,
        className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$cn$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["cn"])('inline-flex items-center justify-center rounded-lg font-medium transition-colors', 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2', 'disabled:cursor-not-allowed disabled:opacity-60', BUTTON_VARIANTS[variant] ?? BUTTON_VARIANTS.primary, BUTTON_SIZES[size] ?? BUTTON_SIZES.md, fullWidth && 'w-full', className),
        ...rest,
        children: [
            loading ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$Spinner$2e$jsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["Spinner"], {
                size: SPINNER_FOR_SIZE[size] ?? 'sm',
                label: null
            }, void 0, false, {
                fileName: "[project]/packages/ui/src/Button.jsx",
                lineNumber: 84,
                columnNumber: 18
            }, this) : null,
            children
        ]
    }, void 0, true, {
        fileName: "[project]/packages/ui/src/Button.jsx",
        lineNumber: 65,
        columnNumber: 5
    }, this);
}
const __TURBOPACK__default__export__ = Button;
}),
"[project]/packages/ui/src/Card.jsx [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "Card",
    ()=>Card,
    "CardBody",
    ()=>CardBody,
    "CardFooter",
    ()=>CardFooter,
    "CardHeader",
    ()=>CardHeader
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@16.3.5_@playwright+test@1.63.0_@types+node@26.5.1_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react-jsx-dev-runtime.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$cn$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/ui/src/cn.js [app-ssr] (ecmascript)");
;
;
function Card({ as: Component = 'div', interactive = false, className, children, ...rest }) {
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(Component, {
        "data-slot": "card",
        className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$cn$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["cn"])('rounded-card border border-slate-200 bg-white text-slate-900 shadow-sm', interactive && 'transition-shadow hover:shadow-md focus-within:ring-2 focus-within:ring-marigold-500 focus-within:ring-offset-2', className),
        ...rest,
        children: children
    }, void 0, false, {
        fileName: "[project]/packages/ui/src/Card.jsx",
        lineNumber: 23,
        columnNumber: 5
    }, this);
}
function CardHeader({ as: Component = 'div', className, children, ...rest }) {
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(Component, {
        "data-slot": "card-header",
        className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$cn$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["cn"])('flex flex-col gap-1 border-b border-slate-200 px-5 py-4', className),
        ...rest,
        children: children
    }, void 0, false, {
        fileName: "[project]/packages/ui/src/Card.jsx",
        lineNumber: 53,
        columnNumber: 5
    }, this);
}
function CardBody({ as: Component = 'div', className, children, ...rest }) {
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(Component, {
        "data-slot": "card-body",
        className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$cn$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["cn"])('px-5 py-4', className),
        ...rest,
        children: children
    }, void 0, false, {
        fileName: "[project]/packages/ui/src/Card.jsx",
        lineNumber: 71,
        columnNumber: 5
    }, this);
}
function CardFooter({ as: Component = 'div', className, children, ...rest }) {
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(Component, {
        "data-slot": "card-footer",
        className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$cn$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["cn"])('flex items-center gap-3 border-t border-slate-200 px-5 py-3', className),
        ...rest,
        children: children
    }, void 0, false, {
        fileName: "[project]/packages/ui/src/Card.jsx",
        lineNumber: 85,
        columnNumber: 5
    }, this);
}
}),
"[project]/packages/ui/src/EmptyState.jsx [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "EmptyState",
    ()=>EmptyState,
    "default",
    ()=>__TURBOPACK__default__export__
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@16.3.5_@playwright+test@1.63.0_@types+node@26.5.1_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react-jsx-dev-runtime.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$cn$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/ui/src/cn.js [app-ssr] (ecmascript)");
;
;
function EmptyState({ title, description, icon, action, headingLevel: Heading = 'h2', className, children, ...rest }) {
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        "data-slot": "empty-state",
        className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$cn$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["cn"])('flex flex-col items-center gap-3 rounded-card border border-dashed border-slate-300 px-6 py-12 text-center', className),
        ...rest,
        children: [
            icon ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                "aria-hidden": "true",
                className: "text-3xl text-slate-400",
                children: icon
            }, void 0, false, {
                fileName: "[project]/packages/ui/src/EmptyState.jsx",
                lineNumber: 45,
                columnNumber: 9
            }, this) : null,
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(Heading, {
                className: "text-lg font-semibold text-slate-900",
                children: title
            }, void 0, false, {
                fileName: "[project]/packages/ui/src/EmptyState.jsx",
                lineNumber: 49,
                columnNumber: 7
            }, this),
            description ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                className: "max-w-prose text-sm text-slate-600",
                children: description
            }, void 0, false, {
                fileName: "[project]/packages/ui/src/EmptyState.jsx",
                lineNumber: 50,
                columnNumber: 22
            }, this) : null,
            children,
            action ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "mt-2",
                children: action
            }, void 0, false, {
                fileName: "[project]/packages/ui/src/EmptyState.jsx",
                lineNumber: 52,
                columnNumber: 17
            }, this) : null
        ]
    }, void 0, true, {
        fileName: "[project]/packages/ui/src/EmptyState.jsx",
        lineNumber: 36,
        columnNumber: 5
    }, this);
}
const __TURBOPACK__default__export__ = EmptyState;
}),
"[project]/packages/ui/src/FormField.jsx [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "FormField",
    ()=>FormField,
    "default",
    ()=>__TURBOPACK__default__export__
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@16.3.5_@playwright+test@1.63.0_@types+node@26.5.1_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react-jsx-dev-runtime.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@16.3.5_@playwright+test@1.63.0_@types+node@26.5.1_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$cn$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/ui/src/cn.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$Label$2e$jsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/ui/src/Label.jsx [app-ssr] (ecmascript)");
;
;
;
;
function FormField({ label, children, description, error, required = false, id, className, ...rest }) {
    const generatedId = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useId"])();
    const controlId = id ?? `field-${generatedId}`;
    const descriptionId = `${controlId}-description`;
    const errorId = `${controlId}-error`;
    const describedBy = (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$cn$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["cn"])(description && descriptionId, error && errorId) || undefined;
    /** @type {FormFieldControlProps} */ const controlProps = {
        id: controlId,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
        required: required || undefined
    };
    let control;
    if (typeof children === 'function') {
        control = children(controlProps);
    } else if (/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["isValidElement"])(children)) {
        // Respect any description the caller already attached to the control.
        const existingDescribedBy = children.props['aria-describedby'];
        control = /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["cloneElement"])(children, {
            ...controlProps,
            'aria-describedby': (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$cn$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["cn"])(existingDescribedBy, describedBy) || undefined
        });
    } else {
        throw new TypeError('FormField expects a single control element or a render function as children');
    }
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        "data-slot": "form-field",
        className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$cn$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["cn"])('flex flex-col gap-1.5', className),
        ...rest,
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$Label$2e$jsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["Label"], {
                htmlFor: controlId,
                required: required,
                children: label
            }, void 0, false, {
                fileName: "[project]/packages/ui/src/FormField.jsx",
                lineNumber: 82,
                columnNumber: 7
            }, this),
            description ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                id: descriptionId,
                className: "text-sm text-slate-500",
                children: description
            }, void 0, false, {
                fileName: "[project]/packages/ui/src/FormField.jsx",
                lineNumber: 86,
                columnNumber: 9
            }, this) : null,
            control,
            error ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                id: errorId,
                role: "alert",
                className: "text-sm font-medium text-rose-700",
                children: error
            }, void 0, false, {
                fileName: "[project]/packages/ui/src/FormField.jsx",
                lineNumber: 92,
                columnNumber: 9
            }, this) : null
        ]
    }, void 0, true, {
        fileName: "[project]/packages/ui/src/FormField.jsx",
        lineNumber: 81,
        columnNumber: 5
    }, this);
}
const __TURBOPACK__default__export__ = FormField;
}),
"[project]/packages/ui/src/Input.jsx [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "Input",
    ()=>Input,
    "default",
    ()=>__TURBOPACK__default__export__
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@16.3.5_@playwright+test@1.63.0_@types+node@26.5.1_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react-jsx-dev-runtime.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$controlClasses$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/ui/src/controlClasses.js [app-ssr] (ecmascript)");
;
;
function Input({ type = 'text', invalid = false, className, ref, 'aria-invalid': ariaInvalid, ...rest }) {
    const isInvalid = (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$controlClasses$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["isInvalidControl"])(invalid, ariaInvalid);
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("input", {
        ref: ref,
        type: type,
        "data-slot": "input",
        "aria-invalid": isInvalid || undefined,
        className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$controlClasses$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["controlClasses"])({
            invalid: isInvalid,
            className
        }),
        ...rest
    }, void 0, false, {
        fileName: "[project]/packages/ui/src/Input.jsx",
        lineNumber: 32,
        columnNumber: 5
    }, this);
}
const __TURBOPACK__default__export__ = Input;
}),
"[project]/packages/ui/src/Label.jsx [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "Label",
    ()=>Label,
    "default",
    ()=>__TURBOPACK__default__export__
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@16.3.5_@playwright+test@1.63.0_@types+node@26.5.1_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react-jsx-dev-runtime.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$cn$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/ui/src/cn.js [app-ssr] (ecmascript)");
;
;
function Label({ htmlFor, required = false, requiredLabel = '(required)', className, children, ...rest }) {
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("label", {
        htmlFor: htmlFor,
        "data-slot": "label",
        className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$cn$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["cn"])('text-sm font-medium text-slate-900', className),
        ...rest,
        children: [
            children,
            required ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["Fragment"], {
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                        "aria-hidden": "true",
                        className: "ml-0.5 text-rose-600",
                        children: "*"
                    }, void 0, false, {
                        fileName: "[project]/packages/ui/src/Label.jsx",
                        lineNumber: 40,
                        columnNumber: 11
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                        className: "sr-only",
                        children: [
                            " ",
                            requiredLabel
                        ]
                    }, void 0, true, {
                        fileName: "[project]/packages/ui/src/Label.jsx",
                        lineNumber: 43,
                        columnNumber: 11
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/packages/ui/src/Label.jsx",
                lineNumber: 39,
                columnNumber: 9
            }, this) : null
        ]
    }, void 0, true, {
        fileName: "[project]/packages/ui/src/Label.jsx",
        lineNumber: 31,
        columnNumber: 5
    }, this);
}
const __TURBOPACK__default__export__ = Label;
}),
"[project]/packages/ui/src/Modal.jsx [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "Modal",
    ()=>Modal,
    "default",
    ()=>__TURBOPACK__default__export__
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@16.3.5_@playwright+test@1.63.0_@types+node@26.5.1_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react-jsx-dev-runtime.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@16.3.5_@playwright+test@1.63.0_@types+node@26.5.1_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$dom$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@16.3.5_@playwright+test@1.63.0_@types+node@26.5.1_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react-dom.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$cn$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/ui/src/cn.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$focus$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/ui/src/focus.js [app-ssr] (ecmascript)");
;
;
;
;
;
/** Tailwind width per modal size. */ const MODAL_SIZES = {
    sm: 'max-w-sm',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl'
};
function Modal({ open, onClose, title, description, footer, children, initialFocusRef, closeOnOverlayClick = true, closeOnEscape = true, showCloseButton = true, closeLabel = 'Close dialog', size = 'md', ariaLabel, container, className, overlayClassName, ...rest }) {
    const dialogRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(null);
    const overlayRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(null);
    const previouslyFocusedRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(null);
    const [mounted, setMounted] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])(false);
    const generatedId = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useId"])();
    const titleId = `modal-${generatedId}-title`;
    const descriptionId = `modal-${generatedId}-description`;
    // Portals need a DOM: render nothing on the server, then mount on the client.
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        setMounted(true);
    }, []);
    // Remember what had focus before the dialog took it, and hand it back on
    // close. Without this a keyboard user is dumped at the top of the document.
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        if (!open) return undefined;
        previouslyFocusedRef.current = document.activeElement;
        return ()=>{
            const previous = previouslyFocusedRef.current;
            previouslyFocusedRef.current = null;
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$focus$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["focusElement"])(previous);
        };
    }, [
        open
    ]);
    // Freeze the page behind the dialog; the cleanup runs on unmount too, so a
    // dialog torn down while open cannot leave the page unscrollable.
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        if (!open) return undefined;
        const { body } = document;
        const previousOverflow = body.style.overflow;
        body.style.overflow = 'hidden';
        return ()=>{
            body.style.overflow = previousOverflow;
        };
    }, [
        open
    ]);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        if (!open || !mounted) return;
        const dialog = dialogRef.current;
        if (!dialog) return;
        // Fall back to the dialog itself so the screen reader reads the title.
        if (!(0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$focus$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["focusElement"])(initialFocusRef?.current)) (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$focus$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["focusElement"])(dialog);
    }, [
        open,
        mounted,
        initialFocusRef
    ]);
    const handleKeyDown = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useCallback"])((event)=>{
        if (event.key === 'Escape' && closeOnEscape) {
            event.stopPropagation();
            onClose?.(event);
            return;
        }
        if (event.key !== 'Tab') return;
        const dialog = dialogRef.current;
        if (!dialog) return;
        const tabbable = (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$focus$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["getTabbableElements"])(dialog);
        if (tabbable.length === 0) {
            event.preventDefault();
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$focus$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["focusElement"])(dialog);
            return;
        }
        const first = tabbable[0];
        const last = tabbable[tabbable.length - 1];
        const active = document.activeElement;
        const inside = dialog.contains(active);
        // The dialog container itself is focusable but not tabbable, so Tab from
        // it must be steered explicitly to the ends of the trapped range.
        if (event.shiftKey && (!inside || active === first || active === dialog)) {
            event.preventDefault();
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$focus$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["focusElement"])(last);
        } else if (!event.shiftKey && (!inside || active === last || active === dialog)) {
            event.preventDefault();
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$focus$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["focusElement"])(first);
        }
    }, [
        closeOnEscape,
        onClose
    ]);
    const handleOverlayMouseDown = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useCallback"])((event)=>{
        if (!closeOnOverlayClick) return;
        if (event.target !== overlayRef.current) return;
        onClose?.(event);
    }, [
        closeOnOverlayClick,
        onClose
    ]);
    if (!open || !mounted) return null;
    const labelledBy = title ? titleId : undefined;
    const dialog = /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        ref: overlayRef,
        "data-slot": "modal-overlay",
        onMouseDown: handleOverlayMouseDown,
        onKeyDown: handleKeyDown,
        className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$cn$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["cn"])('fixed inset-0 z-50 flex items-center justify-center bg-indigo-night-950/60 p-4', overlayClassName),
        children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
            ref: dialogRef,
            role: "dialog",
            "aria-modal": "true",
            "aria-labelledby": labelledBy,
            "aria-label": labelledBy ? undefined : ariaLabel,
            "aria-describedby": description ? descriptionId : undefined,
            tabIndex: -1,
            "data-slot": "modal",
            className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$cn$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["cn"])('flex w-full flex-col gap-4 rounded-card bg-white p-6 shadow-xl focus:outline-none', MODAL_SIZES[size] ?? MODAL_SIZES.md, className),
            ...rest,
            children: [
                title || showCloseButton ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                    className: "flex items-start justify-between gap-4",
                    children: [
                        title ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("h2", {
                            id: titleId,
                            className: "text-lg font-semibold text-slate-900",
                            children: title
                        }, void 0, false, {
                            fileName: "[project]/packages/ui/src/Modal.jsx",
                            lineNumber: 202,
                            columnNumber: 15
                        }, this) : /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {}, void 0, false, {
                            fileName: "[project]/packages/ui/src/Modal.jsx",
                            lineNumber: 206,
                            columnNumber: 15
                        }, this),
                        showCloseButton ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("button", {
                            type: "button",
                            onClick: onClose,
                            className: "-mr-1 -mt-1 rounded p-1 leading-none text-slate-500 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marigold-500",
                            children: [
                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                    "aria-hidden": "true",
                                    children: "×"
                                }, void 0, false, {
                                    fileName: "[project]/packages/ui/src/Modal.jsx",
                                    lineNumber: 214,
                                    columnNumber: 17
                                }, this),
                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                    className: "sr-only",
                                    children: closeLabel
                                }, void 0, false, {
                                    fileName: "[project]/packages/ui/src/Modal.jsx",
                                    lineNumber: 215,
                                    columnNumber: 17
                                }, this)
                            ]
                        }, void 0, true, {
                            fileName: "[project]/packages/ui/src/Modal.jsx",
                            lineNumber: 209,
                            columnNumber: 15
                        }, this) : null
                    ]
                }, void 0, true, {
                    fileName: "[project]/packages/ui/src/Modal.jsx",
                    lineNumber: 200,
                    columnNumber: 11
                }, this) : null,
                description ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                    id: descriptionId,
                    className: "text-sm text-slate-600",
                    children: description
                }, void 0, false, {
                    fileName: "[project]/packages/ui/src/Modal.jsx",
                    lineNumber: 222,
                    columnNumber: 11
                }, this) : null,
                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                    className: "text-sm text-slate-700",
                    children: children
                }, void 0, false, {
                    fileName: "[project]/packages/ui/src/Modal.jsx",
                    lineNumber: 227,
                    columnNumber: 9
                }, this),
                footer ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                    className: "flex items-center justify-end gap-3",
                    children: footer
                }, void 0, false, {
                    fileName: "[project]/packages/ui/src/Modal.jsx",
                    lineNumber: 229,
                    columnNumber: 19
                }, this) : null
            ]
        }, void 0, true, {
            fileName: "[project]/packages/ui/src/Modal.jsx",
            lineNumber: 183,
            columnNumber: 7
        }, this)
    }, void 0, false, {
        fileName: "[project]/packages/ui/src/Modal.jsx",
        lineNumber: 173,
        columnNumber: 5
    }, this);
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$dom$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["createPortal"])(dialog, container ?? document.body);
}
const __TURBOPACK__default__export__ = Modal;
}),
"[project]/packages/ui/src/Select.jsx [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "Select",
    ()=>Select,
    "default",
    ()=>__TURBOPACK__default__export__
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@16.3.5_@playwright+test@1.63.0_@types+node@26.5.1_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react-jsx-dev-runtime.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$controlClasses$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/ui/src/controlClasses.js [app-ssr] (ecmascript)");
;
;
function Select({ options, placeholder, invalid = false, className, children, ref, 'aria-invalid': ariaInvalid, ...rest }) {
    const isInvalid = (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$controlClasses$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["isInvalidControl"])(invalid, ariaInvalid);
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("select", {
        ref: ref,
        "data-slot": "select",
        "aria-invalid": isInvalid || undefined,
        className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$controlClasses$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["controlClasses"])({
            invalid: isInvalid,
            className: [
                'pr-8',
                className
            ]
        }),
        ...rest,
        children: [
            placeholder ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("option", {
                value: "",
                disabled: rest.required,
                children: placeholder
            }, void 0, false, {
                fileName: "[project]/packages/ui/src/Select.jsx",
                lineNumber: 51,
                columnNumber: 9
            }, this) : null,
            children ?? (options ?? []).map((option)=>/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("option", {
                    value: option.value,
                    disabled: option.disabled,
                    children: option.label
                }, option.value, false, {
                    fileName: "[project]/packages/ui/src/Select.jsx",
                    lineNumber: 57,
                    columnNumber: 11
                }, this))
        ]
    }, void 0, true, {
        fileName: "[project]/packages/ui/src/Select.jsx",
        lineNumber: 43,
        columnNumber: 5
    }, this);
}
const __TURBOPACK__default__export__ = Select;
}),
"[project]/packages/ui/src/Skeleton.jsx [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "Skeleton",
    ()=>Skeleton,
    "default",
    ()=>__TURBOPACK__default__export__
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@16.3.5_@playwright+test@1.63.0_@types+node@26.5.1_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react-jsx-dev-runtime.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$cn$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/ui/src/cn.js [app-ssr] (ecmascript)");
;
;
function Skeleton({ as: Component = 'span', lines = 1, className, ...rest }) {
    const bar = 'block animate-pulse rounded-md bg-slate-200/80 dark:bg-slate-700/60';
    if (lines > 1) {
        return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(Component, {
            "aria-hidden": "true",
            "data-slot": "skeleton",
            className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$cn$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["cn"])('block space-y-2', className),
            ...rest,
            children: Array.from({
                length: lines
            }, (_unused, index)=>/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                    className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$cn$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["cn"])(bar, 'h-4', index === lines - 1 ? 'w-2/3' : 'w-full')
                }, index, false, {
                    fileName: "[project]/packages/ui/src/Skeleton.jsx",
                    lineNumber: 32,
                    columnNumber: 11
                }, this))
        }, void 0, false, {
            fileName: "[project]/packages/ui/src/Skeleton.jsx",
            lineNumber: 25,
            columnNumber: 7
        }, this);
    }
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(Component, {
        "aria-hidden": "true",
        "data-slot": "skeleton",
        className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$cn$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["cn"])(bar, 'h-4 w-full', className),
        ...rest
    }, void 0, false, {
        fileName: "[project]/packages/ui/src/Skeleton.jsx",
        lineNumber: 39,
        columnNumber: 5
    }, this);
}
const __TURBOPACK__default__export__ = Skeleton;
}),
"[project]/packages/ui/src/Spinner.jsx [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "Spinner",
    ()=>Spinner,
    "default",
    ()=>__TURBOPACK__default__export__
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@16.3.5_@playwright+test@1.63.0_@types+node@26.5.1_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react-jsx-dev-runtime.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$cn$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/ui/src/cn.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$VisuallyHidden$2e$jsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/ui/src/VisuallyHidden.jsx [app-ssr] (ecmascript)");
;
;
;
/** Tailwind sizing per spinner size token. */ const SPINNER_SIZES = {
    xs: 'h-3 w-3 border',
    sm: 'h-4 w-4 border-2',
    md: 'h-5 w-5 border-2',
    lg: 'h-8 w-8 border-2'
};
function Spinner({ size = 'md', label = 'Loading', className, ...rest }) {
    const circle = /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
        className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$cn$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["cn"])('inline-block animate-spin rounded-full border-current border-t-transparent align-[-0.125em]', SPINNER_SIZES[size] ?? SPINNER_SIZES.md, className)
    }, void 0, false, {
        fileName: "[project]/packages/ui/src/Spinner.jsx",
        lineNumber: 31,
        columnNumber: 5
    }, this);
    if (label == null) {
        return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
            "aria-hidden": "true",
            "data-slot": "spinner",
            ...rest,
            children: circle
        }, void 0, false, {
            fileName: "[project]/packages/ui/src/Spinner.jsx",
            lineNumber: 42,
            columnNumber: 7
        }, this);
    }
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
        role: "status",
        "data-slot": "spinner",
        ...rest,
        children: [
            circle,
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$VisuallyHidden$2e$jsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["VisuallyHidden"], {
                children: label
            }, void 0, false, {
                fileName: "[project]/packages/ui/src/Spinner.jsx",
                lineNumber: 51,
                columnNumber: 7
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/packages/ui/src/Spinner.jsx",
        lineNumber: 49,
        columnNumber: 5
    }, this);
}
const __TURBOPACK__default__export__ = Spinner;
}),
"[project]/packages/ui/src/Tabs.jsx [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "Tabs",
    ()=>Tabs,
    "default",
    ()=>__TURBOPACK__default__export__
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@16.3.5_@playwright+test@1.63.0_@types+node@26.5.1_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react-jsx-dev-runtime.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@16.3.5_@playwright+test@1.63.0_@types+node@26.5.1_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$cn$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/ui/src/cn.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$focus$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/ui/src/focus.js [app-ssr] (ecmascript)");
;
;
;
;
/**
 * @typedef {object} TabItem
 * @property {string} id Stable identifier, used to build the tab and panel ids.
 * @property {ReactNode} label Tab label.
 * @property {ReactNode} [content] Panel content.
 * @property {boolean} [disabled] Whether the tab can be selected.
 */ /**
 * @typedef {object} TabsProps
 * @property {TabItem[]} items Tabs to render, in visual order.
 * @property {string} label Accessible name of the tab list, e.g. "Event sections".
 * @property {string} [defaultTabId] Initially selected tab when uncontrolled. Defaults to the first enabled tab.
 * @property {string} [activeTabId] Selected tab id. Supplying this makes the component controlled.
 * @property {Function} [onChange] Called with the newly selected tab id.
 * @property {'horizontal'|'vertical'} [orientation] Arrow-key axis. Defaults to `horizontal`.
 * @property {'automatic'|'manual'} [activation] `automatic` selects a tab as focus reaches it; `manual` waits for Enter or Space. Defaults to `automatic`.
 * @property {string} [className] Extra classes merged onto the wrapper.
 * @property {string} [listClassName] Extra classes merged onto the tab list.
 * @property {string} [panelClassName] Extra classes merged onto each panel.
 */ /**
 * Find the next selectable tab, skipping disabled ones and wrapping around.
 *
 * @param {TabItem[]} items Tabs in visual order.
 * @param {number} from Index to move away from.
 * @param {number} step `1` to move forward, `-1` to move back.
 * @returns {number} Index of the next enabled tab, or `from` when there is none.
 */ function nextEnabledIndex(items, from, step) {
    const count = items.length;
    for(let offset = 1; offset <= count; offset += 1){
        const index = ((from + step * offset) % count + count) % count;
        if (!items[index].disabled) return index;
    }
    return from;
}
/**
 * Find the first or last selectable tab.
 *
 * @param {TabItem[]} items Tabs in visual order.
 * @param {'first'|'last'} edge Which end to start from.
 * @returns {number} Index of the enabled tab at that edge, or -1 when every tab is disabled.
 */ function edgeEnabledIndex(items, edge) {
    const indexes = items.map((_item, index)=>index);
    const ordered = edge === 'first' ? indexes : indexes.reverse();
    return ordered.find((index)=>!items[index].disabled) ?? -1;
}
function Tabs({ items, label, defaultTabId, activeTabId, onChange, orientation = 'horizontal', activation = 'automatic', className, listClassName, panelClassName, ...rest }) {
    const generatedId = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useId"])();
    const tabRefs = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(new Map());
    const firstEnabled = items[edgeEnabledIndex(items, 'first')];
    const [uncontrolledId, setUncontrolledId] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])(defaultTabId ?? firstEnabled?.id);
    const isControlled = activeTabId != null;
    const currentId = isControlled ? activeTabId : uncontrolledId;
    const selectedIndex = Math.max(items.findIndex((item)=>item.id === currentId), 0);
    const tabId = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useCallback"])((id)=>`tab-${generatedId}-${id}`, [
        generatedId
    ]);
    const panelId = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useCallback"])((id)=>`tabpanel-${generatedId}-${id}`, [
        generatedId
    ]);
    const select = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useCallback"])((index, { moveFocus = true } = {})=>{
        const item = items[index];
        if (!item || item.disabled) return;
        if (!isControlled) setUncontrolledId(item.id);
        if (moveFocus) (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$focus$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["focusElement"])(tabRefs.current.get(item.id));
        if (item.id !== currentId) onChange?.(item.id);
    }, [
        items,
        isControlled,
        currentId,
        onChange
    ]);
    const handleKeyDown = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useCallback"])((event)=>{
        const forwardKey = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight';
        const backKey = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft';
        let target = -1;
        if (event.key === forwardKey) target = nextEnabledIndex(items, selectedIndex, 1);
        else if (event.key === backKey) target = nextEnabledIndex(items, selectedIndex, -1);
        else if (event.key === 'Home') target = edgeEnabledIndex(items, 'first');
        else if (event.key === 'End') target = edgeEnabledIndex(items, 'last');
        else return;
        if (target < 0) return;
        event.preventDefault();
        if (activation === 'manual') {
            // Manual activation moves focus only; selection waits for Enter/Space.
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$focus$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["focusElement"])(tabRefs.current.get(items[target].id));
            return;
        }
        select(target);
    }, [
        orientation,
        items,
        selectedIndex,
        activation,
        select
    ]);
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        "data-slot": "tabs",
        className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$cn$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["cn"])('flex flex-col gap-4', className),
        ...rest,
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                role: "tablist",
                "aria-label": label,
                "aria-orientation": orientation,
                onKeyDown: handleKeyDown,
                className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$cn$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["cn"])('flex gap-1 border-slate-200', orientation === 'vertical' ? 'flex-col border-r pr-2' : 'flex-row border-b', listClassName),
                children: items.map((item, index)=>{
                    const selected = index === selectedIndex;
                    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("button", {
                        type: "button",
                        role: "tab",
                        id: tabId(item.id),
                        ref: (element)=>{
                            if (element) tabRefs.current.set(item.id, element);
                            else tabRefs.current.delete(item.id);
                        },
                        "aria-selected": selected,
                        "aria-controls": panelId(item.id),
                        // Roving tabindex: the tab list is one stop in the page's tab order.
                        tabIndex: selected ? 0 : -1,
                        disabled: item.disabled,
                        onClick: ()=>select(index, {
                                moveFocus: false
                            }),
                        className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$cn$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["cn"])('rounded-t-lg px-4 py-2 text-sm font-medium transition-colors', 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marigold-500', 'disabled:cursor-not-allowed disabled:text-slate-300', selected ? 'border-b-2 border-marigold-600 text-marigold-800' : 'text-slate-600 hover:text-slate-900'),
                        children: item.label
                    }, item.id, false, {
                        fileName: "[project]/packages/ui/src/Tabs.jsx",
                        lineNumber: 161,
                        columnNumber: 13
                    }, this);
                })
            }, void 0, false, {
                fileName: "[project]/packages/ui/src/Tabs.jsx",
                lineNumber: 146,
                columnNumber: 7
            }, this),
            items.map((item, index)=>/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                    role: "tabpanel",
                    id: panelId(item.id),
                    "aria-labelledby": tabId(item.id),
                    hidden: index !== selectedIndex,
                    tabIndex: 0,
                    className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$cn$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["cn"])('focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marigold-500', panelClassName),
                    children: item.content
                }, item.id, false, {
                    fileName: "[project]/packages/ui/src/Tabs.jsx",
                    lineNumber: 192,
                    columnNumber: 9
                }, this))
        ]
    }, void 0, true, {
        fileName: "[project]/packages/ui/src/Tabs.jsx",
        lineNumber: 145,
        columnNumber: 5
    }, this);
}
const __TURBOPACK__default__export__ = Tabs;
}),
"[project]/packages/ui/src/Textarea.jsx [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "Textarea",
    ()=>Textarea,
    "default",
    ()=>__TURBOPACK__default__export__
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@16.3.5_@playwright+test@1.63.0_@types+node@26.5.1_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react-jsx-dev-runtime.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$controlClasses$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/ui/src/controlClasses.js [app-ssr] (ecmascript)");
;
;
function Textarea({ rows = 4, invalid = false, className, ref, 'aria-invalid': ariaInvalid, ...rest }) {
    const isInvalid = (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$controlClasses$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["isInvalidControl"])(invalid, ariaInvalid);
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("textarea", {
        ref: ref,
        rows: rows,
        "data-slot": "textarea",
        "aria-invalid": isInvalid || undefined,
        className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$controlClasses$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["controlClasses"])({
            invalid: isInvalid,
            className: [
                'resize-y',
                className
            ]
        }),
        ...rest
    }, void 0, false, {
        fileName: "[project]/packages/ui/src/Textarea.jsx",
        lineNumber: 28,
        columnNumber: 5
    }, this);
}
const __TURBOPACK__default__export__ = Textarea;
}),
"[project]/packages/ui/src/VisuallyHidden.jsx [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "VisuallyHidden",
    ()=>VisuallyHidden,
    "default",
    ()=>__TURBOPACK__default__export__
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@16.3.5_@playwright+test@1.63.0_@types+node@26.5.1_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react-jsx-dev-runtime.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$cn$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/ui/src/cn.js [app-ssr] (ecmascript)");
;
;
function VisuallyHidden({ as: Component = 'span', focusable = false, className, children, ...rest }) {
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$3$2e$5_$40$playwright$2b$test$40$1$2e$63$2e$0_$40$types$2b$node$40$26$2e$5$2e$1_react$2d$dom$40$19$2e$3$2e$0_react$40$19$2e$3$2e$0_$5f$react$40$19$2e$3$2e$0$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(Component, {
        className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$cn$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["cn"])('sr-only', focusable && 'focus:not-sr-only', className),
        ...rest,
        children: children
    }, void 0, false, {
        fileName: "[project]/packages/ui/src/VisuallyHidden.jsx",
        lineNumber: 29,
        columnNumber: 5
    }, this);
}
const __TURBOPACK__default__export__ = VisuallyHidden;
}),
"[project]/packages/ui/src/cn.js [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "cn",
    ()=>cn,
    "default",
    ()=>__TURBOPACK__default__export__
]);
/**
 * Class name composition for the component library.
 *
 * Every component funnels its own Tailwind utilities and the caller's
 * `className` through {@link cn}, so consumers can always extend or override
 * the styling of a primitive without forking it.
 *
 * @module @desi-event/ui/cn
 */ var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$clsx$40$2$2e$1$2e$1$2f$node_modules$2f$clsx$2f$dist$2f$clsx$2e$mjs__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/clsx@2.1.1/node_modules/clsx/dist/clsx.mjs [app-ssr] (ecmascript)");
;
function cn(...classes) {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$clsx$40$2$2e$1$2e$1$2f$node_modules$2f$clsx$2f$dist$2f$clsx$2e$mjs__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["default"])(...classes);
}
const __TURBOPACK__default__export__ = cn;
}),
"[project]/packages/ui/src/controlClasses.js [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "CONTROL_BASE_CLASSES",
    ()=>CONTROL_BASE_CLASSES,
    "CONTROL_INVALID_CLASSES",
    ()=>CONTROL_INVALID_CLASSES,
    "CONTROL_VALID_CLASSES",
    ()=>CONTROL_VALID_CLASSES,
    "controlClasses",
    ()=>controlClasses,
    "isInvalidControl",
    ()=>isInvalidControl
]);
/**
 * Shared Tailwind classes for the native form controls (`Input`, `Textarea`,
 * `Select`) so that the three stay visually identical and gain a consistent
 * invalid state.
 *
 * @module @desi-event/ui/controlClasses
 */ var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$cn$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/ui/src/cn.js [app-ssr] (ecmascript)");
;
const CONTROL_BASE_CLASSES = 'block w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-900 shadow-sm ' + 'placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-offset-1 ' + 'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500';
const CONTROL_VALID_CLASSES = 'border-slate-300 focus:border-marigold-500 focus:ring-marigold-500';
const CONTROL_INVALID_CLASSES = 'border-rose-500 focus:border-rose-600 focus:ring-rose-500';
function controlClasses({ invalid = false, className } = {}) {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$cn$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["cn"])(CONTROL_BASE_CLASSES, invalid ? CONTROL_INVALID_CLASSES : CONTROL_VALID_CLASSES, className);
}
function isInvalidControl(invalid, ariaInvalid) {
    return Boolean(invalid) || ariaInvalid === true || ariaInvalid === 'true';
}
}),
"[project]/packages/ui/src/focus.js [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "focusElement",
    ()=>focusElement,
    "getTabbableElements",
    ()=>getTabbableElements
]);
/**
 * Focus helpers shared by the components that manage focus themselves.
 *
 * The queries here are always rooted at an element obtained from a React ref;
 * nothing in this library reaches into the document to find its own markup.
 *
 * @module @desi-event/ui/focus
 */ /** Selector covering everything the platform makes focusable by default. */ const FOCUSABLE_SELECTOR = [
    'a[href]',
    'area[href]',
    'button',
    'input',
    'select',
    'textarea',
    'iframe',
    'summary',
    'audio[controls]',
    'video[controls]',
    '[contenteditable]:not([contenteditable="false"])',
    '[tabindex]'
].join(',');
function getTabbableElements(container) {
    if (!container) return [];
    return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter((element)=>{
        if (element.hasAttribute('disabled')) return false;
        if (element.hasAttribute('hidden')) return false;
        if (element.getAttribute('aria-hidden') === 'true') return false;
        const tabIndex = element.getAttribute('tabindex');
        if (tabIndex !== null && Number(tabIndex) < 0) return false;
        return true;
    });
}
function focusElement(element) {
    if (!element || typeof element.focus !== 'function') return false;
    if (!element.isConnected) return false;
    element.focus();
    return true;
}
}),
"[project]/packages/ui/src/index.js [app-ssr] (ecmascript) <locals>", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([]);
/**
 * `@desi-event/ui` — the accessible React primitives shared by the Desi-Event
 * web application.
 *
 * Every component here is plain JSX styled with Tailwind utility classes and
 * accepts a `className` that is merged last, so a consumer can restyle a
 * primitive without reimplementing its behaviour. Accessibility is part of the
 * component contract rather than something applications bolt on: labels are
 * tied to controls, errors are announced, and the dialog and tab patterns
 * implement their full keyboard behaviour.
 *
 * @module @desi-event/ui
 */ var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$cn$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/ui/src/cn.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$Button$2e$jsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/ui/src/Button.jsx [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$Badge$2e$jsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/ui/src/Badge.jsx [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$Card$2e$jsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/ui/src/Card.jsx [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$Input$2e$jsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/ui/src/Input.jsx [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$Textarea$2e$jsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/ui/src/Textarea.jsx [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$Select$2e$jsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/ui/src/Select.jsx [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$Label$2e$jsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/ui/src/Label.jsx [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$FormField$2e$jsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/ui/src/FormField.jsx [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$Alert$2e$jsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/ui/src/Alert.jsx [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$Spinner$2e$jsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/ui/src/Spinner.jsx [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$Skeleton$2e$jsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/ui/src/Skeleton.jsx [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$EmptyState$2e$jsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/ui/src/EmptyState.jsx [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$VisuallyHidden$2e$jsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/ui/src/VisuallyHidden.jsx [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$Modal$2e$jsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/ui/src/Modal.jsx [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2f$src$2f$Tabs$2e$jsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/ui/src/Tabs.jsx [app-ssr] (ecmascript)");
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
;
;
;
;
}),
];

//# sourceMappingURL=_1ron1g6._.js.map