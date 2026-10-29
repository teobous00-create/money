//+------------------------------------------------------------------+
//| MoneySync.mq5                                                    |
//| Sends each day's closed P&L per strategy (by magic number) to    |
//| the Money app. Read-only: it never opens, changes or closes a    |
//| trade.                                                           |
//|                                                                  |
//| Setup                                                            |
//| 1. Tools → Options → Expert Advisors → tick "Allow WebRequest    |
//|    for listed URL" and add  https://foeojetroiwchtacmbga.supabase.co
//| 2. Attach to any one chart. Fill SyncKey and Strategies.         |
//+------------------------------------------------------------------+
#property copyright "Teo"
#property version   "1.00"

input string SyncKey    = "";                                        // Sync key (same as PNL_SYNC_KEY in Supabase)
input string Strategies = "1001=DEEP DIP GOLD; 1002=Gold Sniper";   // magic=strategy name as in the app, separated by ;
input int    DaysBack   = 7;                                         // days re-sent each time (also fills days the PC was off)
input bool   IncludeManual = false;                                  // also send trades without a magic number
input string ManualName = "Manual";                                  // ...as this strategy
input int    EveryMinutes = 15;                                      // full re-send at least this often
input string Url = "https://foeojetroiwchtacmbga.supabase.co/functions/v1/pnl-sync";

long     g_magic[];
string   g_name[];
bool     g_pending = true;
datetime g_last    = 0;
string   g_warned  = "";

//+------------------------------------------------------------------+
int OnInit()
  {
   if(StringLen(SyncKey) < 20) { Print("MoneySync: fill in SyncKey."); return INIT_PARAMETERS_INCORRECT; }
   if(!ParseStrategies()) return INIT_PARAMETERS_INCORRECT;
   EventSetTimer(60);
   Print("MoneySync: watching ", ArraySize(g_magic), " strategies.");
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason) { EventKillTimer(); }

// a deal was added (a trade opened or closed) → send soon
void OnTradeTransaction(const MqlTradeTransaction &trans, const MqlTradeRequest &request, const MqlTradeResult &result)
  {
   if(trans.type == TRADE_TRANSACTION_DEAL_ADD) g_pending = true;
  }

void OnTimer()
  {
   if(g_pending || TimeLocal() - g_last >= EveryMinutes * 60) Sync();
  }

//+------------------------------------------------------------------+
//| "1001=DEEP DIP GOLD; 1002=Gold Sniper"                           |
//+------------------------------------------------------------------+
bool ParseStrategies()
  {
   string parts[];
   int n = StringSplit(Strategies, ';', parts);
   ArrayResize(g_magic, 0); ArrayResize(g_name, 0);
   for(int i = 0; i < n; i++)
     {
      string p = parts[i];
      StringTrimLeft(p); StringTrimRight(p);
      if(p == "") continue;
      int eq = StringFind(p, "=");
      if(eq <= 0) { Print("MoneySync: can't read \"", p, "\" — use magic=name"); return false; }
      string m = StringSubstr(p, 0, eq), name = StringSubstr(p, eq + 1);
      StringTrimLeft(m); StringTrimRight(m); StringTrimLeft(name); StringTrimRight(name);
      long magic = StringToInteger(m);
      if(magic <= 0 || name == "") { Print("MoneySync: can't read \"", p, "\""); return false; }
      int k = ArraySize(g_magic);
      ArrayResize(g_magic, k + 1); ArrayResize(g_name, k + 1);
      g_magic[k] = magic; g_name[k] = name;
     }
   if(ArraySize(g_magic) == 0 && !IncludeManual) { Print("MoneySync: no strategies given."); return false; }
   return true;
  }

string NameOf(long magic)
  {
   if(magic == 0) return IncludeManual ? ManualName : "";
   for(int i = 0; i < ArraySize(g_magic); i++) if(g_magic[i] == magic) return g_name[i];
   string tag = "|" + IntegerToString(magic) + "|";
   if(StringFind(g_warned, tag) < 0) { g_warned += tag; Print("MoneySync: magic ", magic, " is not in Strategies — skipped."); }
   return "";
  }

// the magic of the EA that opened the position (an SL/TP close may not carry it)
long MagicOfPosition(long position_id)
  {
   if(!HistorySelectByPosition(position_id)) return 0;
   for(int i = 0; i < HistoryDealsTotal(); i++)
     {
      ulong t = HistoryDealGetTicket(i);
      if(HistoryDealGetInteger(t, DEAL_ENTRY) == DEAL_ENTRY_IN) return HistoryDealGetInteger(t, DEAL_MAGIC);
     }
   return 0;
  }

string Esc(string s)
  {
   StringReplace(s, "\\", "\\\\");
   StringReplace(s, "\"", "\\\"");
   return s;
  }

//+------------------------------------------------------------------+
//| Add up every deal in the last DaysBack days by (day, strategy)   |
//| and send the totals. Profit + swap + commission + fee.           |
//+------------------------------------------------------------------+
void Sync()
  {
   datetime now  = TimeCurrent();
   int back = MathMax(1, MathMin(DaysBack, 60));
   datetime from = (datetime)(StringToTime(TimeToString(now, TIME_DATE)) - (back - 1) * 86400);
   if(!HistorySelect(from, now + 86400)) { Print("MoneySync: history not ready, will retry."); return; }

   // read everything first: HistorySelectByPosition below replaces the selection
   int total = HistoryDealsTotal();
   string   d_day[];   long d_magic[]; long d_pos[]; double d_val[];
   ArrayResize(d_day, total); ArrayResize(d_magic, total); ArrayResize(d_pos, total); ArrayResize(d_val, total);
   int n = 0;
   for(int i = 0; i < total; i++)
     {
      ulong t = HistoryDealGetTicket(i);
      if(t == 0) continue;
      long type = HistoryDealGetInteger(t, DEAL_TYPE);
      if(type != DEAL_TYPE_BUY && type != DEAL_TYPE_SELL) continue;          // skips deposits, withdrawals, credit
      double v = HistoryDealGetDouble(t, DEAL_PROFIT) + HistoryDealGetDouble(t, DEAL_SWAP)
               + HistoryDealGetDouble(t, DEAL_COMMISSION) + HistoryDealGetDouble(t, DEAL_FEE);
      string day = TimeToString((datetime)HistoryDealGetInteger(t, DEAL_TIME), TIME_DATE);   // broker time, "2026.10.28"
      StringReplace(day, ".", "-");
      d_day[n] = day; d_magic[n] = HistoryDealGetInteger(t, DEAL_MAGIC); d_pos[n] = HistoryDealGetInteger(t, DEAL_POSITION_ID); d_val[n] = v;
      n++;
     }

   // group by day + strategy
   string g_key[]; string g_day[]; string g_str[]; double g_sum[];
   int g = 0;
   for(int i = 0; i < n; i++)
     {
      long magic = d_magic[i];
      if(magic == 0 && d_pos[i] > 0) magic = MagicOfPosition(d_pos[i]);
      string name = NameOf(magic);
      if(name == "") continue;
      string key = d_day[i] + "|" + name;
      int k = -1;
      for(int j = 0; j < g; j++) if(g_key[j] == key) { k = j; break; }
      if(k < 0)
        {
         k = g; g++;
         ArrayResize(g_key, g); ArrayResize(g_day, g); ArrayResize(g_str, g); ArrayResize(g_sum, g);
         g_key[k] = key; g_day[k] = d_day[i]; g_str[k] = name; g_sum[k] = 0;
        }
      g_sum[k] += d_val[i];
     }

   string body = "{\"days\":[";
   for(int k = 0; k < g; k++)
     {
      if(k > 0) body += ",";
      body += "{\"strategy\":\"" + Esc(g_str[k]) + "\",\"date\":\"" + g_day[k] + "\",\"pnl\":" + DoubleToString(g_sum[k], 2) + "}";
     }
   body += "]}";

   if(Send(body, g)) { g_pending = false; g_last = TimeLocal(); }
  }

bool Send(string body, int count)
  {
   char data[], result[];
   string resHeaders;
   int len = StringToCharArray(body, data, 0, WHOLE_ARRAY, CP_UTF8);
   if(len > 0) ArrayResize(data, len - 1);                                    // drop the trailing \0
   string headers = "Content-Type: application/json\r\nx-sync-key: " + SyncKey + "\r\n";
   ResetLastError();
   int code = WebRequest("POST", Url, headers, 10000, data, result, resHeaders);
   string reply = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
   if(code == -1)
     {
      int err = GetLastError();
      if(err == 4014) Print("MoneySync: allow the URL first — Tools → Options → Expert Advisors → Allow WebRequest → add https://foeojetroiwchtacmbga.supabase.co");
      else Print("MoneySync: no connection (error ", err, "), will retry.");
      return false;
     }
   if(code != 200) { Print("MoneySync: server said ", code, " ", reply); return false; }
   if(StringFind(reply, "\"unknown_strategies\":[]") < 0) Print("MoneySync: some names are not strategies in the app — check spelling: ", reply);
   Print("MoneySync: sent ", count, " day totals. ", reply);
   return true;
  }
//+------------------------------------------------------------------+
