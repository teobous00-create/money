//+------------------------------------------------------------------+
//| MagicList.mq5 — script: lists every magic number in your trade   |
//| history with its symbol, comment, dates and result, so you can   |
//| tell which EA each one belongs to. Read-only.                    |
//| Put it in MQL5\Scripts, compile, drag it onto any chart.         |
//| The list appears in the Experts tab.                             |
//+------------------------------------------------------------------+
#property script_show_inputs
input int DaysBack = 90;   // how far back to look

void OnStart()
  {
   datetime now = TimeCurrent();
   if(!HistorySelect(now - DaysBack * 86400, now + 86400)) { Print("MagicList: history not ready."); return; }
   long   mg[];  string sym[]; string cmt[]; int cnt[]; double res[]; datetime first[]; datetime last[];
   int n = 0;
   for(int i = 0; i < HistoryDealsTotal(); i++)
     {
      ulong t = HistoryDealGetTicket(i);
      if(t == 0) continue;
      long type = HistoryDealGetInteger(t, DEAL_TYPE);
      if(type != DEAL_TYPE_BUY && type != DEAL_TYPE_SELL) continue;
      long m = HistoryDealGetInteger(t, DEAL_MAGIC);
      datetime when = (datetime)HistoryDealGetInteger(t, DEAL_TIME);
      double v = HistoryDealGetDouble(t, DEAL_PROFIT) + HistoryDealGetDouble(t, DEAL_SWAP) + HistoryDealGetDouble(t, DEAL_COMMISSION) + HistoryDealGetDouble(t, DEAL_FEE);
      int k = -1;
      for(int j = 0; j < n; j++) if(mg[j] == m) { k = j; break; }
      if(k < 0)
        {
         k = n; n++;
         ArrayResize(mg, n); ArrayResize(sym, n); ArrayResize(cmt, n); ArrayResize(cnt, n); ArrayResize(res, n); ArrayResize(first, n); ArrayResize(last, n);
         mg[k] = m; sym[k] = HistoryDealGetString(t, DEAL_SYMBOL); cmt[k] = ""; cnt[k] = 0; res[k] = 0; first[k] = when; last[k] = when;
        }
      string c = HistoryDealGetString(t, DEAL_COMMENT);
      if(c != "" && cmt[k] == "") cmt[k] = c;
      if(HistoryDealGetInteger(t, DEAL_ENTRY) == DEAL_ENTRY_IN) cnt[k]++;
      res[k] += v;
      if(when < first[k]) first[k] = when;
      if(when > last[k]) last[k] = when;
     }
   Print("MagicList: ", n, " magic numbers in the last ", DaysBack, " days:");
   for(int k = 0; k < n; k++)
      Print("  magic ", mg[k], " | ", sym[k], " | ", cnt[k], " trades | ", TimeToString(first[k], TIME_DATE), " → ", TimeToString(last[k], TIME_DATE),
            " | result ", DoubleToString(res[k], 2), " | comment \"", cmt[k], "\"");
  }
//+------------------------------------------------------------------+
