import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { marketApi } from '../services/marketApi';

const normalizeSymbol = (value) => String(value || '').trim().toUpperCase().replace('.', '-');

const StockSearchInput = ({
  value = '',
  token,
  onSelect,
  placeholder = 'Search markets',
  limit = 8,
  clearOnSelect = false,
  disabled = false,
  className = '',
}) => {
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  const [open, setOpen] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    setQuery(value || '');
  }, [value]);

  useEffect(() => {
    const trimmed = query.trim();
    if (disabled || !token || trimmed.length < 1) {
      setResults([]);
      setLoading(false);
      setError('');
      setHasSearched(false);
      return undefined;
    }

    const currentRequestId = requestId.current + 1;
    requestId.current = currentRequestId;

    const timeoutId = window.setTimeout(async () => {
      setLoading(true);
      setError('');
      setHasSearched(false);
      try {
        const response = await marketApi.search(trimmed, limit, token);
        if (requestId.current === currentRequestId) {
          setResults(response.results || []);
          setOpen(true);
          setHasSearched(true);
        }
      } catch (err) {
        if (requestId.current === currentRequestId) {
          setResults([]);
          setError(err.message);
          setOpen(true);
          setHasSearched(true);
        }
      } finally {
        if (requestId.current === currentRequestId) {
          setLoading(false);
        }
      }
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [query, token, limit, disabled]);

  const exactResult = useMemo(() => {
    const symbol = normalizeSymbol(query);
    return results.find((result) => normalizeSymbol(result.symbol) === symbol);
  }, [query, results]);

  const chooseResult = (result) => {
    const symbol = normalizeSymbol(result?.symbol);
    if (!symbol) return;

    setQuery(clearOnSelect ? '' : symbol);
    setOpen(false);
    setResults([]);
    onSelect?.({ ...result, symbol });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    let selectedResult = exactResult || results[0];

    if (!selectedResult && query.trim()) {
      setLoading(true);
      setError('');
      try {
        const response = await marketApi.search(query.trim(), limit, token);
        const nextResults = response.results || [];
        setResults(nextResults);
        selectedResult = nextResults.find((result) => normalizeSymbol(result.symbol) === normalizeSymbol(query)) || nextResults[0];
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    if (!selectedResult) {
      setError('No supported stock matches that search.');
      setOpen(true);
      return;
    }

    chooseResult(selectedResult);
  };

  return (
    <form onSubmit={handleSubmit} className={`relative ${className}`}>
      <Search className="absolute left-4 top-3.5 text-slate-500" size={20} />
      <input
        type="text"
        value={query}
        disabled={disabled}
        onChange={(event) => {
          setQuery(event.target.value);
          setError('');
          setHasSearched(false);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        placeholder={placeholder}
        className="w-full bg-slate-800 border border-slate-700 rounded-full pl-12 pr-14 py-3 text-white shadow-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all disabled:cursor-not-allowed disabled:opacity-60"
      />
      <button
        type="submit"
        disabled={disabled || !query.trim()}
        title="Search"
        className="absolute right-2 top-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 disabled:text-slate-500 text-white p-2 rounded-full transition-colors"
      >
        {loading ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} />}
      </button>

      {open && query.trim() && (results.length > 0 || error || hasSearched) && (
        <div className="absolute z-30 mt-2 w-full overflow-hidden rounded-lg border border-slate-700 bg-slate-900 shadow-xl">
          {results.map((result) => (
            <button
              type="button"
              key={`${result.symbol}-${result.exchange || ''}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => chooseResult(result)}
              className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-slate-800 transition-colors"
            >
              <span className="min-w-0">
                <span className="block font-mono text-sm font-bold text-white">{result.symbol}</span>
                <span className="block truncate text-xs text-slate-400">{result.name}</span>
              </span>
              <span className="shrink-0 text-xs text-slate-500">{result.exchange || result.type}</span>
            </button>
          ))}

          {error && (
            <div className="px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}

          {!error && !loading && hasSearched && results.length === 0 && (
            <div className="px-4 py-3 text-sm text-slate-400">
              No supported stock matches that search.
            </div>
          )}
        </div>
      )}
    </form>
  );
};

export default StockSearchInput;
