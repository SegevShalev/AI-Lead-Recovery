export type LeadKind = "lead" | "quote" | "dormant";
export type LeadStatus = "sent" | "dismissed";

export interface ThreadMessage {
  from: "them" | "us";
  text: string;
  time: string;
}

export interface Lead {
  id: number;
  name: string;
  vehicle: string;
  phone: string;
  kind: LeadKind;
  value: number;
  elapsedDays: number;
  snippet: string;
  rationale: string;
  thread: ThreadMessage[];
  draft: string;
}

export interface Bucket {
  key: LeadKind;
  title: string;
  note: string;
  barColor: string;
}

// Fake data for Phase 1 UI work — replace with real API data once services/api exposes leads.
export const LEADS: Lead[] = [
  {
    id: 1,
    name: "Marcus Whitfield",
    vehicle: "2019 Ford Transit · brake job",
    phone: "+1 (416) 555-0142",
    kind: "quote",
    value: 1840,
    elapsedDays: 9,
    snippet: "Ok let me check with my partner and get back to you tomorrow",
    rationale: "Quote sent, no reply in 9 days",
    thread: [
      {
        from: "them",
        text: "Hi, van is pulling to the right when I brake. Can you look at it Thursday?",
        time: "Aug 18, 9:12 AM",
      },
      {
        from: "us",
        text: "Yes — bring it by 8am. We'll do a full brake inspection, no charge for the look.",
        time: "Aug 18, 9:40 AM",
      },
      {
        from: "us",
        text: "Inspection done: front rotors are warped and pads are at 15%. Full front brake service is $1,840 including parts and labour, about half a day. Want me to book it?",
        time: "Aug 20, 2:05 PM",
      },
      {
        from: "them",
        text: "Ok let me check with my partner and get back to you tomorrow",
        time: "Aug 20, 6:31 PM",
      },
    ],
    draft:
      "Hi Marcus — following up on the front brake service for the Transit ($1,840). Warped rotors get worse fast, and I'd rather catch it before it takes the calipers with it. I've still got Thursday morning open this week if you want it. Want me to hold the slot?",
  },
  {
    id: 2,
    name: "Priya Raghunathan",
    vehicle: "2021 Honda CR-V · winter tires",
    phone: "+1 (416) 555-0198",
    kind: "lead",
    value: 1120,
    elapsedDays: 14,
    snippet: "How much for four winter tires on the CR-V?",
    rationale: "Never answered — 14 days",
    thread: [
      {
        from: "them",
        text: "Hi, a friend recommended you. How much for four winter tires on the CR-V? 2021.",
        time: "Aug 15, 7:48 PM",
      },
      { from: "them", text: "Also do you store the summer set?", time: "Aug 15, 7:49 PM" },
    ],
    draft:
      "Hi Priya — sorry for the slow reply, that one slipped past us. Four winter tires mounted and balanced for the CR-V runs $1,120 all in, and yes, we store your summer set for $80 a season. Booking early beats the November rush — want me to put you down for a morning next week?",
  },
  {
    id: 3,
    name: "Devon Ackerley",
    vehicle: "2016 RAM 1500 · transmission",
    phone: "+1 (416) 555-0177",
    kind: "quote",
    value: 3250,
    elapsedDays: 21,
    snippet: "That's more than I expected. Is there a cheaper option?",
    rationale: "Price objection, never handled",
    thread: [
      {
        from: "them",
        text: "Truck is slipping between 2nd and 3rd. Bad?",
        time: "Aug 8, 11:02 AM",
      },
      { from: "us", text: "Could be. Bring it in and we'll scan it.", time: "Aug 8, 11:20 AM" },
      {
        from: "us",
        text: "Transmission rebuild, $3,250 with a 2-year warranty. It's the honest fix — a fluid service would just delay it.",
        time: "Aug 10, 4:15 PM",
      },
      {
        from: "them",
        text: "That's more than I expected. Is there a cheaper option?",
        time: "Aug 10, 8:02 PM",
      },
    ],
    draft:
      "Hi Devon — thinking about your RAM. I can do the rebuild in two stages: valve body and solenoids now at $1,400, then the full rebuild later if it keeps slipping. We also do 12-month financing at 0% on jobs over $2,000. Which of those works better for you?",
  },
  {
    id: 4,
    name: "Sandra Oyelaran",
    vehicle: "2018 Toyota Corolla · oil + service",
    phone: "+1 (416) 555-0163",
    kind: "dormant",
    value: 420,
    elapsedDays: 214,
    snippet: "Thanks, see you in the spring!",
    rationale: "Was every 4 months, now 7 months gone",
    thread: [
      {
        from: "us",
        text: "All done — oil, filter, and we topped up the coolant. See you in about four months.",
        time: "Jan 29, 3:12 PM",
      },
      { from: "them", text: "Thanks, see you in the spring!", time: "Jan 29, 4:40 PM" },
    ],
    draft:
      "Hi Sandra — the Corolla is about three months overdue for its oil change based on your usual schedule. I've got Tuesday and Wednesday afternoon open this week and can have you out in 45 minutes. Want one of those?",
  },
  {
    id: 5,
    name: "Tomasz Wierzbicki",
    vehicle: "2020 Subaru Outback · suspension",
    phone: "+1 (416) 555-0121",
    kind: "quote",
    value: 2260,
    elapsedDays: 12,
    snippet: "Send me the breakdown and I'll decide this week",
    rationale: "Asked for a breakdown, never got one",
    thread: [
      {
        from: "them",
        text: "Front end clunks over bumps. Any chance you can look this week?",
        time: "Aug 14, 8:30 AM",
      },
      {
        from: "us",
        text: "Struts and sway bar links are shot. Full front suspension refresh is $2,260.",
        time: "Aug 17, 1:22 PM",
      },
      {
        from: "them",
        text: "Send me the breakdown and I'll decide this week",
        time: "Aug 17, 5:55 PM",
      },
    ],
    draft:
      "Hi Tomasz — here's the breakdown you asked for: struts $980, sway bar links $240, labour $860, alignment $180. Total $2,260, one day in the shop. The clunk won't hurt anything short term but it'll chew through your front tires. Want me to book it in?",
  },
  {
    id: 6,
    name: "Elena Ferraro",
    vehicle: "2017 VW Golf · A/C repair",
    phone: "+1 (416) 555-0154",
    kind: "lead",
    value: 680,
    elapsedDays: 6,
    snippet: "A/C blowing warm again, same as last year",
    rationale: "New enquiry, no reply in 6 days",
    thread: [
      {
        from: "them",
        text: "A/C blowing warm again, same as last year 😩 are you taking cars this week?",
        time: "Aug 23, 12:14 PM",
      },
    ],
    draft:
      "Hi Elena — yes, we can take the Golf this week. If it's warm again a year on, there's likely a slow leak rather than just low refrigerant, so we'd dye-test it first ($120, credited against the repair). Thursday or Friday morning?",
  },
  {
    id: 7,
    name: "Ray Okonkwo Contracting",
    vehicle: "Fleet · 4 vehicles",
    phone: "+1 (416) 555-0188",
    kind: "dormant",
    value: 5400,
    elapsedDays: 167,
    snippet: "Perfect, we'll do the other two next quarter",
    rationale: "Fleet account, 2 vehicles never booked",
    thread: [
      {
        from: "us",
        text: "Both vans are done — brakes and full service. Invoice sent.",
        time: "Mar 17, 5:02 PM",
      },
      {
        from: "them",
        text: "Perfect, we'll do the other two next quarter",
        time: "Mar 17, 6:20 PM",
      },
    ],
    draft:
      "Hi Ray — you mentioned bringing the other two vans in last quarter. We've got capacity the week of the 8th and can do both in two days so you're never down more than one vehicle. Same fleet rate as March. Want me to pencil it in?",
  },
  {
    id: 8,
    name: "Nadia Brant",
    vehicle: "2022 Kia Sportage · warranty service",
    phone: "+1 (416) 555-0135",
    kind: "lead",
    value: 390,
    elapsedDays: 5,
    snippet: "Do you do the 40,000km service or does it have to be the dealer?",
    rationale: "Question unanswered — 5 days",
    thread: [
      {
        from: "them",
        text: "Do you do the 40,000km service or does it have to be the dealer?",
        time: "Aug 24, 10:05 AM",
      },
    ],
    draft:
      "Hi Nadia — we can absolutely do the 40,000km service and it does not void your warranty; we log everything to the manufacturer schedule. It's $390 versus about $560 at the dealer. Want to come in this week?",
  },
];

export const BUCKETS: Bucket[] = [
  {
    key: "lead",
    title: "Leads with no follow-up",
    note: "Enquiries that never got a reply from you",
    barColor: "#12A05C",
  },
  {
    key: "quote",
    title: "Quotes with no response",
    note: "You quoted, then it went quiet",
    barColor: "#D98A1F",
  },
  {
    key: "dormant",
    title: "Recurring customers gone quiet",
    note: "Past their usual return window",
    barColor: "#7B6BD6",
  },
];

export const KIND_LABEL: Record<LeadKind, string> = {
  lead: "No follow-up sent",
  quote: "Quote unanswered",
  dormant: "Overdue for return",
};

export const BASE_RECOVERED_THIS_MONTH = 6280;
export const REPLY_RATE_LABEL = "41%";
export const SYNCED_AGO_LABEL = "4 min ago";
export const BUSINESS_NAME = "Northgate Auto Care";
