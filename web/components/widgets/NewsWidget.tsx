"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { apiGet } from "../../lib/api";
import { isSafeHttpUrl } from "../../lib/links";
import { useWidgetSymbol, type WidgetInstance } from "../../store/terminal";

type NewsItem = { title: string; link: string; publisher: string; publishedAt: string | null };

export default function NewsWidget({
  widget,
  pageSize = 6,
}: {
  widget: WidgetInstance;
  pageSize?: number;
}) {
  const symbol = useWidgetSymbol(widget);
  const [mode, setMode] = useState<"symbol" | "global">("symbol");
  const [page, setPage] = useState(0);
  const size = Math.max(1, Math.floor(pageSize));

  const { data = [], isLoading } = useQuery({
    queryKey: ["news", mode, symbol],
    queryFn: () => apiGet<NewsItem[]>(mode === "symbol" ? `/api/news?symbol=${encodeURIComponent(symbol)}` : "/api/news"),
    refetchInterval: 30_000,
  });

  useEffect(() => {
    setPage(0);
  }, [mode, symbol]);

  const pageCount = Math.max(1, Math.ceil(data.length / size));
  const current = Math.min(page, pageCount - 1);
  const start = current * size;
  const visible = data.slice(start, start + size);
  const from = data.length === 0 ? 0 : start + 1;
  const to = Math.min(start + size, data.length);

  useEffect(() => {
    setPage((value) => Math.min(value, pageCount - 1));
  }, [pageCount]);

  return (
    <div className="news-widget">
      <div className="news-mode flex gap-1 p-2">
        <button
          type="button"
          className={`term-btn ${mode === "symbol" ? "active" : ""}`}
          onClick={() => setMode("symbol")}
        >
          {symbol}
        </button>
        <button
          type="button"
          className={`term-btn ${mode === "global" ? "active" : ""}`}
          onClick={() => setMode("global")}
        >
          Global
        </button>
      </div>

      {isLoading ? (
        <div className="p-3 dim">Loading news…</div>
      ) : visible.length === 0 ? (
        <div className="p-3 dim">No news available.</div>
      ) : (
        <div className="news-list">
          {visible.map((item, index) => {
            const body = (
              <>
                <div className="news-item-title">{item.title}</div>
                <div className="news-item-meta">
                  {item.publisher}
                  {item.publishedAt ? `, ${new Date(item.publishedAt).toLocaleString()}` : ""}
                </div>
              </>
            );
            return isSafeHttpUrl(item.link) ? (
              <a
                key={`${item.link}-${index}`}
                href={item.link}
                target="_blank"
                rel="noreferrer"
                className="news-item"
              >
                {body}
              </a>
            ) : (
              <div key={`${item.title}-${index}`} className="news-item">
                {body}
              </div>
            );
          })}
        </div>
      )}

      {pageCount > 1 && (
        <div className="news-pager" role="group" aria-label="News pagination">
          <span className="dim text-[11px]">
            {from}-{to} of {data.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="term-btn"
              disabled={current === 0}
              onClick={() => setPage(current - 1)}
              aria-label="Previous news page"
            >
              Prev
            </button>
            <span className="dim text-[11px]">
              {current + 1} / {pageCount}
            </span>
            <button
              type="button"
              className="term-btn"
              disabled={current >= pageCount - 1}
              onClick={() => setPage(current + 1)}
              aria-label="Next news page"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
