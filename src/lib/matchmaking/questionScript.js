export const QUESTION_PLAN = [
  { id: "name_confirm",   field: "name",            kind: "confirm_or_replace", prompt: "I have your name as {{name}} — should I call you that, or do you go by something else?" },
  { id: "year",           field: "year_of_school",  kind: "choice",  options: ["Freshman","Sophomore","Junior","Senior","Grad","Med","Other"] },
  { id: "group_size",     field: "group_size",       kind: "choice",  options: ["1","2","3","4","5","6+"] },
  { id: "budget",         field: "budget",           kind: "budget_range" },
  { id: "area",           field: "area",             kind: "multi",   options: ["The Loop","Central West End","Clayton","DeMun","DeBaliviere","No preference"] },
  { id: "lease_term",     field: "lease_term",       kind: "choice",  options: ["Semester only","Full year only","Open to either"] },
  { id: "move_in_window", field: "move_in_dates",    kind: "date_range" },
  { id: "furnished",      field: "furnished",        kind: "yesno_pref" },
  { id: "commute",        field: "commute",          kind: "multi",   options: ["Walk","Bike","Drive","Transit"] },
  { id: "priorities",     field: "priorities",       kind: "pick_two", options: ["Close to campus","Good value","Great reviews","Amenities","Quiet/study","Social/parties","Close to other WashU students"] },
];

export const WEIGHT_MAP = {
  budget:     { budget: 0.7 },
  area:       { location: 0.7, walkability: 0.4 },
  lease_term: { lease_flexibility: 0.6 },
  furnished:  { amenities: 0.3 },
  commute:    { walkability: 0.6 },
  priorities: {},
};
