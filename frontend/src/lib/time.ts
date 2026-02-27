export const WORKDAY_HOURS = 8;

export const roundHours = (value: number) => Math.round(value * 10) / 10;

export const toHours = (days: number) => roundHours(days * WORKDAY_HOURS);
