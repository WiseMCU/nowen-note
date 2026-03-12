import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  Flame,
  FileText,
  Type,
  Smile,
  Cloud,
  Sun,
  CloudRain,
  CloudSnow,
  CloudLightning,
  Wind,
  CloudFog,
  Loader2,
  Trash2,
  Check,
  Save,
} from "lucide-react";
import { api } from "@/lib/api";
import { Diary, DiaryListItem, DiaryStats } from "@/types";
import TiptapEditor from "@/components/TiptapEditor";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { ScrollArea } from "@/components/ui/scroll-area";

// 心情选项
const MOODS = [
  { value: "happy", emoji: "😊", label: "diary.moodHappy" },
  { value: "excited", emoji: "🥳", label: "diary.moodExcited" },
  { value: "peaceful", emoji: "😌", label: "diary.moodPeaceful" },
  { value: "thinking", emoji: "🤔", label: "diary.moodThinking" },
  { value: "tired", emoji: "😴", label: "diary.moodTired" },
  { value: "sad", emoji: "😢", label: "diary.moodSad" },
  { value: "angry", emoji: "😤", label: "diary.moodAngry" },
  { value: "sick", emoji: "🤒", label: "diary.moodSick" },
];

// 天气选项
const WEATHERS = [
  { value: "sunny", icon: Sun, label: "diary.weatherSunny" },
  { value: "cloudy", icon: Cloud, label: "diary.weatherCloudy" },
  { value: "rainy", icon: CloudRain, label: "diary.weatherRainy" },
  { value: "snowy", icon: CloudSnow, label: "diary.weatherSnowy" },
  { value: "stormy", icon: CloudLightning, label: "diary.weatherStormy" },
  { value: "windy", icon: Wind, label: "diary.weatherWindy" },
  { value: "foggy", icon: CloudFog, label: "diary.weatherFoggy" },
];

function formatDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function isSameDay(d1: string, d2: string): boolean {
  return d1 === d2;
}

function isToday(dateStr: string): boolean {
  return dateStr === formatDate(new Date());
}

// ============================================================
// 日历面板组件
// ============================================================
function CalendarPanel({
  selectedDate,
  onSelectDate,
  diaryDates,
  onMonthChange,
}: {
  selectedDate: string;
  onSelectDate: (date: string) => void;
  diaryDates: Map<string, DiaryListItem>;
  onMonthChange: (year: number, month: number) => void;
}) {
  const { t } = useTranslation();
  const todayStr = formatDate(new Date());

  // 从 selectedDate 解析出当前显示的年月
  const [viewYear, setViewYear] = useState(() => parseInt(selectedDate.split("-")[0]));
  const [viewMonth, setViewMonth] = useState(() => parseInt(selectedDate.split("-")[1]));

  const weekDays = [
    t("diary.weekSun"),
    t("diary.weekMon"),
    t("diary.weekTue"),
    t("diary.weekWed"),
    t("diary.weekThu"),
    t("diary.weekFri"),
    t("diary.weekSat"),
  ];

  // 计算日历格子
  const calendarDays = useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth - 1, 1);
    const lastDay = new Date(viewYear, viewMonth, 0);
    const startPad = firstDay.getDay(); // 0=Sun
    const totalDays = lastDay.getDate();

    const days: { date: string; day: number; isCurrentMonth: boolean }[] = [];

    // 上月填充
    const prevMonthLast = new Date(viewYear, viewMonth - 1, 0).getDate();
    for (let i = startPad - 1; i >= 0; i--) {
      const d = prevMonthLast - i;
      const m = viewMonth - 1 < 1 ? 12 : viewMonth - 1;
      const y = viewMonth - 1 < 1 ? viewYear - 1 : viewYear;
      days.push({ date: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`, day: d, isCurrentMonth: false });
    }

    // 当月
    for (let d = 1; d <= totalDays; d++) {
      days.push({ date: `${viewYear}-${String(viewMonth).padStart(2, "0")}-${String(d).padStart(2, "0")}`, day: d, isCurrentMonth: true });
    }

    // 下月填充（补到 42 格 = 6 行）
    const remaining = 42 - days.length;
    for (let d = 1; d <= remaining; d++) {
      const m = viewMonth + 1 > 12 ? 1 : viewMonth + 1;
      const y = viewMonth + 1 > 12 ? viewYear + 1 : viewYear;
      days.push({ date: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`, day: d, isCurrentMonth: false });
    }

    return days;
  }, [viewYear, viewMonth]);

  const goToPrev = () => {
    let m = viewMonth - 1;
    let y = viewYear;
    if (m < 1) { m = 12; y--; }
    setViewMonth(m);
    setViewYear(y);
    onMonthChange(y, m);
  };

  const goToNext = () => {
    let m = viewMonth + 1;
    let y = viewYear;
    if (m > 12) { m = 1; y++; }
    setViewMonth(m);
    setViewYear(y);
    onMonthChange(y, m);
  };

  const goToToday = () => {
    const now = new Date();
    setViewYear(now.getFullYear());
    setViewMonth(now.getMonth() + 1);
    onSelectDate(todayStr);
    onMonthChange(now.getFullYear(), now.getMonth() + 1);
  };

  return (
    <div className="select-none">
      {/* 月份导航 */}
      <div className="flex items-center justify-between mb-4">
        <button onClick={goToPrev} className="p-1.5 rounded-lg hover:bg-app-hover text-tx-secondary transition-colors">
          <ChevronLeft size={16} />
        </button>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-tx-primary">
            {t("diary.monthLabel", { year: viewYear, month: viewMonth })}
          </span>
          <button
            onClick={goToToday}
            className="text-[10px] px-2 py-0.5 rounded-full bg-accent-primary/10 text-accent-primary hover:bg-accent-primary/20 transition-colors font-medium"
          >
            {t("diary.today")}
          </button>
        </div>
        <button onClick={goToNext} className="p-1.5 rounded-lg hover:bg-app-hover text-tx-secondary transition-colors">
          <ChevronRight size={16} />
        </button>
      </div>

      {/* 星期标题 */}
      <div className="grid grid-cols-7 gap-1 mb-1">
        {weekDays.map((d) => (
          <div key={d} className="text-center text-[10px] font-medium text-tx-tertiary py-1">
            {d}
          </div>
        ))}
      </div>

      {/* 日期格子 */}
      <div className="grid grid-cols-7 gap-1">
        {calendarDays.map(({ date, day, isCurrentMonth }) => {
          const isSelected = isSameDay(date, selectedDate);
          const isTodayDate = isToday(date);
          const hasDiary = diaryDates.has(date);
          const diaryItem = diaryDates.get(date);
          const moodEmoji = diaryItem ? MOODS.find((m) => m.value === diaryItem.mood)?.emoji : null;

          return (
            <button
              key={date}
              onClick={() => onSelectDate(date)}
              className={cn(
                "relative aspect-square flex flex-col items-center justify-center rounded-lg text-xs transition-all duration-150",
                !isCurrentMonth && "opacity-30",
                isSelected
                  ? "bg-accent-primary text-white shadow-sm shadow-accent-primary/30 scale-105"
                  : isTodayDate
                    ? "bg-accent-primary/10 text-accent-primary font-semibold ring-1 ring-accent-primary/30"
                    : "text-tx-secondary hover:bg-app-hover",
                hasDiary && !isSelected && "font-medium text-tx-primary"
              )}
            >
              <span className={cn("text-[11px] leading-none", isSelected && "font-bold")}>{day}</span>
              {/* 日记指示器 */}
              {hasDiary && (
                <span className={cn(
                  "absolute bottom-0.5 text-[7px] leading-none",
                  isSelected ? "opacity-80" : ""
                )}>
                  {moodEmoji || "•"}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// 心情选择器
// ============================================================
function MoodSelector({
  value,
  onChange,
}: {
  value: string;
  onChange: (mood: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-1">
      {MOODS.map(({ value: v, emoji, label }) => (
        <button
          key={v}
          onClick={() => onChange(value === v ? "" : v)}
          className={cn(
            "w-7 h-7 rounded-lg flex items-center justify-center text-sm transition-all",
            value === v
              ? "bg-accent-primary/15 scale-110 ring-1 ring-accent-primary/30"
              : "hover:bg-app-hover hover:scale-105"
          )}
          title={t(label)}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

// ============================================================
// 天气选择器
// ============================================================
function WeatherSelector({
  value,
  onChange,
}: {
  value: string;
  onChange: (weather: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-1">
      {WEATHERS.map(({ value: v, icon: Icon, label }) => (
        <button
          key={v}
          onClick={() => onChange(value === v ? "" : v)}
          className={cn(
            "w-7 h-7 rounded-lg flex items-center justify-center transition-all",
            value === v
              ? "bg-accent-primary/15 scale-110 ring-1 ring-accent-primary/30 text-accent-primary"
              : "text-tx-tertiary hover:text-tx-secondary hover:bg-app-hover hover:scale-105"
          )}
          title={t(label)}
        >
          <Icon size={14} />
        </button>
      ))}
    </div>
  );
}

// ============================================================
// 统计卡片
// ============================================================
function StatsPanel({ stats }: { stats: DiaryStats | null }) {
  const { t } = useTranslation();
  if (!stats) return null;

  const items = [
    { icon: Flame, value: stats.streak, label: t("diary.statsStreak"), color: "text-orange-500" },
    { icon: FileText, value: stats.total, label: t("diary.statsTotal"), color: "text-blue-500" },
    { icon: Type, value: stats.totalWords.toLocaleString(), label: t("diary.statsWords"), color: "text-emerald-500" },
    { icon: CalendarDays, value: stats.monthCount, label: t("diary.statsMonth"), color: "text-violet-500" },
  ];

  return (
    <div className="grid grid-cols-2 gap-2">
      {items.map(({ icon: Icon, value, label, color }) => (
        <div key={label} className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-app-hover/50">
          <Icon size={14} className={color} />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-tx-primary leading-none">{value}</div>
            <div className="text-[10px] text-tx-tertiary mt-0.5 truncate">{label}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// 主组件：DiaryCenter
// ============================================================
export default function DiaryCenter() {
  const { t } = useTranslation();
  const [selectedDate, setSelectedDate] = useState(() => formatDate(new Date()));
  const [diary, setDiary] = useState<Diary | null>(null);
  const [diaryMap, setDiaryMap] = useState<Map<string, DiaryListItem>>(new Map());
  const [stats, setStats] = useState<DiaryStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [mood, setMood] = useState("");
  const [weather, setWeather] = useState("");
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const savedTimerRef = useRef<NodeJS.Timeout | null>(null);

  // 加载月度数据
  const loadMonth = useCallback(async (year: number, month: number) => {
    try {
      const items = await api.getDiaryMonth(year, month);
      setDiaryMap((prev) => {
        const next = new Map(prev);
        items.forEach((item) => next.set(item.date, item));
        return next;
      });
    } catch (e) {
      console.error("Failed to load month diary:", e);
    }
  }, []);

  // 加载指定日期的日记
  const loadDiary = useCallback(async (date: string) => {
    setLoading(true);
    try {
      const d = await api.getDiaryByDate(date);
      setDiary(d);
      setMood(d?.mood || "");
      setWeather(d?.weather || "");
    } catch {
      setDiary(null);
      setMood("");
      setWeather("");
    } finally {
      setLoading(false);
    }
  }, []);

  // 加载统计
  const loadStats = useCallback(async () => {
    try {
      const s = await api.getDiaryStats();
      setStats(s);
    } catch {/* ignore */}
  }, []);

  // 初始化加载
  useEffect(() => {
    const now = new Date();
    loadMonth(now.getFullYear(), now.getMonth() + 1);
    loadDiary(formatDate(now));
    loadStats();
  }, [loadMonth, loadDiary, loadStats]);

  // 切换日期
  const handleSelectDate = useCallback((date: string) => {
    setSelectedDate(date);
    loadDiary(date);
  }, [loadDiary]);

  // 切换月份
  const handleMonthChange = useCallback((year: number, month: number) => {
    loadMonth(year, month);
  }, [loadMonth]);

  // 保存日记（防抖）
  const saveDiary = useCallback(async (data: { content?: string; contentText?: string; mood?: string; weather?: string }) => {
    setSaving(true);
    setSaved(false);
    try {
      const updated = await api.saveDiary(selectedDate, data);
      setDiary(updated);
      // 更新日历上的指示
      setDiaryMap((prev) => {
        const next = new Map(prev);
        next.set(selectedDate, {
          id: updated.id,
          date: updated.date,
          mood: updated.mood,
          weather: updated.weather,
          wordCount: updated.wordCount,
          preview: updated.contentText?.slice(0, 100) || "",
          createdAt: updated.createdAt,
          updatedAt: updated.updatedAt,
        });
        return next;
      });
      loadStats();
      setSaved(true);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      console.error("Save diary failed:", e);
    } finally {
      setSaving(false);
    }
  }, [selectedDate, loadStats]);

  // 编辑器内容变化
  const handleEditorUpdate = useCallback((data: { content: string; contentText: string; title: string }) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveDiary({ content: data.content, contentText: data.contentText, mood, weather });
    }, 800);
  }, [saveDiary, mood, weather]);

  // 心情/天气变化 — 立即保存
  const handleMoodChange = useCallback((newMood: string) => {
    setMood(newMood);
    saveDiary({ mood: newMood, weather, content: diary?.content, contentText: diary?.contentText });
  }, [saveDiary, weather, diary]);

  const handleWeatherChange = useCallback((newWeather: string) => {
    setWeather(newWeather);
    saveDiary({ mood, weather: newWeather, content: diary?.content, contentText: diary?.contentText });
  }, [saveDiary, mood, diary]);

  // 删除日记
  const handleDelete = useCallback(async () => {
    if (!diary) return;
    if (!window.confirm(t("diary.deleteConfirm"))) return;
    try {
      await api.deleteDiary(diary.id);
      setDiary(null);
      setMood("");
      setWeather("");
      setDiaryMap((prev) => {
        const next = new Map(prev);
        next.delete(selectedDate);
        return next;
      });
      loadStats();
    } catch (e) {
      console.error("Delete diary failed:", e);
    }
  }, [diary, selectedDate, t, loadStats]);

  // 将 Diary 适配为 TiptapEditor 需要的 Note 格式
  const editorNote = useMemo(() => {
    if (!diary) {
      return {
        id: `diary-${selectedDate}`,
        userId: "",
        notebookId: "",
        title: "",
        content: "{}",
        contentText: "",
        isPinned: 0,
        isFavorite: 0,
        isLocked: 0,
        isArchived: 0,
        isTrashed: 0,
        trashedAt: null,
        version: 1,
        sortOrder: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
    return {
      id: diary.id,
      userId: diary.userId,
      notebookId: "",
      title: "",
      content: diary.content,
      contentText: diary.contentText,
      isPinned: 0,
      isFavorite: 0,
      isLocked: 0,
      isArchived: 0,
      isTrashed: 0,
      trashedAt: null,
      version: 1,
      sortOrder: 0,
      createdAt: diary.createdAt,
      updatedAt: diary.updatedAt,
    };
  }, [diary, selectedDate]);

  // 解析日期显示
  const selectedDateObj = new Date(selectedDate + "T00:00:00");
  const dayOfWeek = [
    t("diary.sunday"), t("diary.monday"), t("diary.tuesday"),
    t("diary.wednesday"), t("diary.thursday"), t("diary.friday"), t("diary.saturday"),
  ][selectedDateObj.getDay()];

  const selectedMoodEmoji = MOODS.find((m) => m.value === mood)?.emoji;
  const SelectedWeatherIcon = WEATHERS.find((w) => w.value === weather)?.icon;

  return (
    <div className="flex-1 flex h-full overflow-hidden bg-app-bg transition-colors">
      {/* ===== 左侧面板：日历 + 统计 ===== */}
      <div className="hidden md:flex flex-col w-[280px] shrink-0 border-r border-app-border bg-app-surface/30">
        <ScrollArea className="flex-1">
          <div className="p-4 space-y-5">
            {/* 日历 */}
            <CalendarPanel
              selectedDate={selectedDate}
              onSelectDate={handleSelectDate}
              diaryDates={diaryMap}
              onMonthChange={handleMonthChange}
            />

            {/* 分割线 */}
            <div className="h-px bg-app-border" />

            {/* 统计 */}
            <div>
              <h3 className="text-[11px] font-medium text-tx-tertiary uppercase tracking-wider mb-2">
                {t("diary.statistics")}
              </h3>
              <StatsPanel stats={stats} />
            </div>

            {/* 当日预览 */}
            {diary && diary.contentText && (
              <>
                <div className="h-px bg-app-border" />
                <div>
                  <h3 className="text-[11px] font-medium text-tx-tertiary uppercase tracking-wider mb-2">
                    {t("diary.preview")}
                  </h3>
                  <p className="text-xs text-tx-secondary leading-relaxed line-clamp-6">
                    {diary.contentText.slice(0, 300)}
                  </p>
                </div>
              </>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* ===== 右侧：日记编辑区 ===== */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 顶部信息栏 */}
        <div className="shrink-0 border-b border-app-border bg-app-surface/30 px-4 md:px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* 日期 */}
              <div className="flex items-center gap-2">
                <div className={cn(
                  "w-10 h-10 rounded-xl flex items-center justify-center text-lg font-bold",
                  isToday(selectedDate)
                    ? "bg-accent-primary text-white"
                    : "bg-app-hover text-tx-primary"
                )}>
                  {selectedDateObj.getDate()}
                </div>
                <div>
                  <div className="text-sm font-semibold text-tx-primary">
                    {dayOfWeek}
                    {isToday(selectedDate) && (
                      <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-accent-primary/10 text-accent-primary font-medium">
                        {t("diary.today")}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-tx-tertiary">
                    {selectedDate}
                    {selectedMoodEmoji && <span className="ml-1.5">{selectedMoodEmoji}</span>}
                    {SelectedWeatherIcon && <SelectedWeatherIcon size={12} className="inline ml-1 text-tx-tertiary" />}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* 保存状态 */}
              <div className="flex items-center gap-1.5 text-[11px]">
                {saving && <Loader2 size={12} className="animate-spin text-accent-primary" />}
                {saved && <Check size={12} className="text-green-500" />}
                <span className={cn(
                  "hidden sm:inline",
                  saving && "text-accent-primary",
                  saved && "text-green-500",
                  !saving && !saved && "text-tx-tertiary"
                )}>
                  {saving ? t("diary.saving") : saved ? t("diary.saved") : diary ? t("diary.autoSave") : ""}
                </span>
              </div>

              {/* 字数 */}
              {diary && (
                <span className="text-[10px] text-tx-tertiary bg-app-hover/50 px-2 py-0.5 rounded-full">
                  {diary.wordCount.toLocaleString()} {t("diary.words")}
                </span>
              )}

              {/* 删除 */}
              {diary && (
                <button
                  onClick={handleDelete}
                  className="p-1.5 rounded-lg text-tx-tertiary hover:text-red-500 hover:bg-red-500/10 transition-colors"
                  title={t("diary.delete")}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>

          {/* 心情 & 天气选择 */}
          <div className="flex flex-wrap items-center gap-3 mt-3">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-tx-tertiary font-medium uppercase tracking-wide">
                {t("diary.mood")}
              </span>
              <MoodSelector value={mood} onChange={handleMoodChange} />
            </div>
            <div className="w-px h-5 bg-app-border hidden sm:block" />
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-tx-tertiary font-medium uppercase tracking-wide">
                {t("diary.weather")}
              </span>
              <WeatherSelector value={weather} onChange={handleWeatherChange} />
            </div>
          </div>
        </div>

        {/* 编辑器区域 */}
        <div className="flex-1 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 size={24} className="animate-spin text-accent-primary" />
            </div>
          ) : (
            <TiptapEditor
              key={selectedDate}
              note={editorNote as any}
              onUpdate={handleEditorUpdate}
              editable={true}
            />
          )}
        </div>
      </div>

      {/* ===== 移动端：底部日历抽屉（通过浮动按钮触发） ===== */}
      <MobileCalendarFAB
        selectedDate={selectedDate}
        onSelectDate={handleSelectDate}
        diaryDates={diaryMap}
        onMonthChange={handleMonthChange}
        stats={stats}
      />
    </div>
  );
}

// ============================================================
// 移动端浮动日历按钮 + 底部抽屉
// ============================================================
function MobileCalendarFAB({
  selectedDate,
  onSelectDate,
  diaryDates,
  onMonthChange,
  stats,
}: {
  selectedDate: string;
  onSelectDate: (date: string) => void;
  diaryDates: Map<string, DiaryListItem>;
  onMonthChange: (year: number, month: number) => void;
  stats: DiaryStats | null;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="md:hidden">
      {/* FAB */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-30 w-12 h-12 rounded-full bg-accent-primary text-white shadow-lg shadow-accent-primary/30 flex items-center justify-center hover:scale-105 active:scale-95 transition-transform"
      >
        <CalendarDays size={20} />
      </button>

      {/* 底部抽屉 */}
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-40 bg-zinc-900/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", bounce: 0, duration: 0.35 }}
              className="fixed bottom-0 left-0 right-0 z-50 bg-app-elevated rounded-t-2xl shadow-2xl max-h-[80vh] overflow-auto"
            >
              <div className="p-4 space-y-4">
                {/* 拖拽指示条 */}
                <div className="flex justify-center">
                  <div className="w-10 h-1 rounded-full bg-app-border" />
                </div>

                <CalendarPanel
                  selectedDate={selectedDate}
                  onSelectDate={(d) => { onSelectDate(d); setOpen(false); }}
                  diaryDates={diaryDates}
                  onMonthChange={onMonthChange}
                />

                <div className="h-px bg-app-border" />

                <StatsPanel stats={stats} />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
