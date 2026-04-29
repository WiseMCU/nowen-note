export class DateUtil {
  static formatRelative(dateStr: string): string {
    if (!dateStr) return '';
    try {
      const date = new Date(dateStr);
      const now = new Date();
      const diff = now.getTime() - date.getTime();

      if (diff < 0) return DateUtil.formatShort(dateStr);

      const minutes = Math.floor(diff / 60000);
      const hours = Math.floor(diff / 3600000);
      const days = Math.floor(diff / 86400000);

      if (minutes < 1) return '刚刚';
      if (minutes < 60) return `${minutes}分钟前`;
      if (hours < 24) return `${hours}小时前`;
      if (days < 7) return `${days}天前`;
      if (days < 30) return `${Math.floor(days / 7)}周前`;
      if (days < 365) return `${Math.floor(days / 30)}月前`;
      return `${Math.floor(days / 365)}年前`;
    } catch (e) {
      return dateStr;
    }
  }

  static formatShort(dateStr: string): string {
    if (!dateStr) return '';
    try {
      const date = new Date(dateStr);
      return `${date.getMonth() + 1}/${date.getDate()}`;
    } catch (e) {
      return dateStr;
    }
  }

  static formatFull(dateStr: string): string {
    if (!dateStr) return '';
    try {
      const date = new Date(dateStr);
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      const h = String(date.getHours()).padStart(2, '0');
      const min = String(date.getMinutes()).padStart(2, '0');
      return `${y}-${m}-${d} ${h}:${min}`;
    } catch (e) {
      return dateStr;
    }
  }

  static isOverdue(dateStr: string | null): boolean {
    if (!dateStr) return false;
    try {
      return new Date(dateStr).getTime() < Date.now();
    } catch (e) {
      return false;
    }
  }

  static isToday(dateStr: string | null): boolean {
    if (!dateStr) return false;
    try {
      const date = new Date(dateStr);
      const now = new Date();
      return date.getFullYear() === now.getFullYear() &&
        date.getMonth() === now.getMonth() &&
        date.getDate() === now.getDate();
    } catch (e) {
      return false;
    }
  }
}

export class TextUtil {
  static truncate(text: string, maxLength: number): string {
    if (!text) return '';
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
  }

  static stripMarkdown(text: string): string {
    if (!text) return '';
    return text
      .replace(/!\[.*?\]\(.*?\)/g, '')
      .replace(/\[([^\]]*)\]\([^\)]*\)/g, '$1')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/[*_~`]/g, '')
      .replace(/^[-*+]\s+/gm, '')
      .replace(/^\d+\.\s+/gm, '')
      .replace(/^>\s+/gm, '')
      .trim();
  }

  static extractTitle(content: string): string {
    if (!content) return '无标题';
    const firstLine = content.split('\n')[0].trim();
    const headingMatch = firstLine.match(/^#{1,6}\s+(.+)/);
    if (headingMatch) return headingMatch[1].trim();
    return firstLine || '无标题';
  }

  static generateId(): string {
    const chars = '0123456789abcdef';
    let id = '';
    for (let i = 0; i < 32; i++) {
      id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return id;
  }
}

export class Validator {
  static isValidServerUrl(url: string): boolean {
    if (!url) return false;
    return /^https?:\/\/.+/.test(url);
  }

  static isValidUsername(username: string): boolean {
    return username.length >= 2 && username.length <= 32 && /^[a-zA-Z0-9_]+$/.test(username);
  }

  static isValidPassword(password: string): boolean {
    return password.length >= 4;
  }
}
