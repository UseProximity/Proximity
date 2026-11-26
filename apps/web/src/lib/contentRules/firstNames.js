/*
 * Name lists behind the "no names in user-written text" rule (lib/contentRules).
 *
 * Two buckets, because the cost of a false positive is a landlord or student
 * who cannot save their work:
 *
 *   CLEAR_NAMES   - reads as a person almost anywhere it appears. Flagged on
 *                   sight (minus the address/building suppressors).
 *   CONTEXT_NAMES - also an ordinary English word, a month, a brand, or a
 *                   St. Louis street/neighborhood. "Max", "Grant", "Clayton",
 *                   "Harvard" and friends only count when the sentence around
 *                   them is talking about a person.
 *
 * Lowercase, no duplicates across the two sets. Add to CONTEXT_NAMES when in
 * doubt: the worst case there is a name that slips through, not a blocked save.
 */

const CLEAR = `
aaliyah aaron abby abdul abdullah abel abigail abraham ada adam addison adela adelaide adeline
adrian adriana adrianna adrienne agnes ahmad ahmed aidan aiden aileen aimee aisha alan alana
alanna albert alberto aldo alec alejandra alejandro alessandra alex alexa alexander alexandra
alexandria alexia alexis alfonso alfred alfredo ali alice alicia alina alisha alison alissa
allan allen allie allison alma alondra alonzo althea alvin alyssa amalia amanda amara amari
amaya amber amelia amina amir amira amy ana anabel anastasia anders anderson andre andrea
andreas andres andrew andrea angela angelica angelina angelo angie anika anil anish anita
anjali ann anna annabel annabelle anne annette annie anthony antoine antonia antonio anya
april arjun arlene armando arnold arturo arun asha ashlee ashley ashlyn asma astrid athena
aubrey audra audrey augustine aurelia aurora ava averie avi ayaan ayesha ayla bailey barbara
barry beatrice beatriz becky belinda belle benedict benjamin bernadette bernard bernice bertha
bethany betsy bette bettina betty beverly bianca blanca bobbi bonnie boris bradley brandi
brandon brandy breanna brenda brendan brennan brent brett brian briana brianna bridget brigitte
britney brittany brittney brody bruce bruno bryan bryant bryce bryson caitlin caitlyn caleb
callie calvin cameron camila camille candace cara caridad carina carl carla carlos carly
carmen carol carole carolina caroline carolyn carrie cassandra cassidy cassie catalina
catherine cathleen cathy cecelia cecilia cedric celeste celia cesar chad chandra chanel
chantal charlene charles charlie charmaine chelsea cheryl chester chloe chris christa
christian christina christine christopher chrystal cindy claire clara clarence clarissa claude
claudia clement clifford clinton cody colin colleen collin conner connie connor conrad
constance consuelo cora corey corinne cornelius cortney courtney craig cristina cristobal
crystal curtis cynthia cyrus daisy dakota damian damien damon dana danica daniel daniela
daniella danielle danny dante daphne darcy daria darius darla darlene darnell darrell darren
darryl daryl dave david dawson dayana deandre deanna deborah debra declan deirdre deja delia
delilah della delores demetrius denis denise dennis denny derek derrick desiree desmond devin
devon diana diane dianna diego dilip dimitri dina dolores dominic dominique donald donna donovan
dora doreen dorian doris dorothy douglas doyle duane dulce duncan dustin dwayne dwight dylan
earnest ebony eddie edgar edith edmund edna eduardo edward edwin efrain eileen elaine elba
eleanor elena eli elias elijah elisa elisabeth elise eliza elizabeth ella ellen elliot elliott
ellis eloise elsa elsie elvira emanuel emerson emilia emiliano emilio emily emma emmanuel
emmett enrique eric erica erick erik erika erin ernest ernesto esmeralda esperanza essie
estela estella esther ethan ethel eugene eugenia eula eunice eva evan evangelina eve evelyn
everett ezekiel ezra fabian faisal fannie farah farhan fatima felicia felipe felix fernanda
fernando fidel filip fiona flora florence floyd forrest frances francesca francesco francine
francis francisco franklin fred freda freddie frederick fredrick freya gabriel gabriela
gabriella gabrielle gail gale gareth garrett gary gavin gayle gemma genevieve geoffrey george
georgina gerald geraldine gerard german gerardo gertrude gilbert gilberto gina giovanni
giselle gladys glenda gloria gonzalo gordon graciela graham gregg gregory greta gretchen
griffin guadalupe guillermo gustavo gwen gwendolyn hailey haley hana hannah hans harold
harriet harrison harry harvey hassan hattie heather hector heidi helen helena henrietta henry
herbert herman hilda hillary hiroshi hollis horace howard hubert hugh hugo humberto ian ibrahim
ida ignacio igor ilene imani imelda immanuel ines ingrid irene irma isaac isabel isabella
isabelle isaiah isidro ismael israel ivan ivana jabari jacinta jack jackie jacklyn jaclyn
jacob jacqueline jacques jada jade jaden jaime jairo jamal jamar james jamie jan jana jane
janelle janet janice janine janis jared jasmin jasmine jason javier jay jayden jaylen jean
jeanette jeanne jeannette jeff jeffery jeffrey jenna jennie jennifer jenny jerald jeremiah
jeremy jermaine jerome jerry jesse jessica jessie jesus jill jillian jimmy joan joanna joanne
joaquin jocelyn jodi jodie jody joe joel joey johanna john johnathan johnny jolene jonah
jonathan jonathon jordan jorge jose josefina joseph josephine josh joshua josiah josue jovan
juan juana juanita judith judy julia julian juliana julianna julie juliet juliette julio
julius justin justine kaitlin kaitlyn kaleb kamala kara kareem karen kari karina karl karla
karma karyn kasey kate katelyn katharine katherine kathleen kathryn kathy katie katrina kavya
kayla kaylee keith kellie kelly kelsey kelvin ken kendall kendra kendrick kenneth kenny
kerri kerry keshav kevin khalid kiara kiera kim kimberly kirk kirsten kizzy kristen kristi
kristie kristin kristina kristine kristy krystal kurt kwame kyle kylie kyra lacey ladonna
laila lakeisha lana landon larissa larry latasha latisha latoya laura lauren laurence lavern
laverne lawrence layla lazaro leah leanne lee leigh leila lena lenora leo leon leona leonard
leonardo leonel leroy lesley leslie lester leticia levi lewis liam liana lidia lila lilian
liliana lillian lillie lilly lilyana lina linda lindsay lindsey linnea lionel lisa liza lloyd
logan lois lola lorena lorenzo loretta lori lorraine louie louisa louise lourdes lucas
lucia lucian luciana lucille lucinda lucy luis luisa luke lula luther luz lydia lyle lynda
lyndon lynette lynn mabel mable madeleine madeline madelyn madhu madison mae maggie magnus
mahmoud maira malachi malcolm malik mallory mamie mandy manuel manuela mara marc marcel
marcela marcella marcia marco marcos marcus margaret margarita margie marguerite maria mariah
mariam marian mariana marianne maribel maricela marie marielle marilyn marina mario marion
marisa marisol marissa maritza marjorie marlene marlon marsha marshall marta martha martin
martina marty marva marvin mary maryann matilda matt matthew mattie maureen maurice mauricio
mavis maxine maya mayra mckenna megan meghan mehmet melanie melba melinda melisa melissa
melvin mercedes meredith merle mia micah michael micheal michele michelle miguel mikayla mike
mikhail mildred milton mindy minerva miranda miriam mitchell moe mohamed mohammad mohammed
moises molly mona monica monique morgan moses muhammad murray mustafa myra myrna myron myrtle
nadia nadine nancy naomi natalia natalie natasha nathan nathaniel neal ned neil nelda nelson
nettie nia nichole nicolas nicole nikhil nikita nikki nilda nina noah noel noelle nolan nora
norma norman nova nydia octavia odette ofelia olga olivia ollie omar oneida ophelia oren
orlando oscar oswaldo otis owen pablo padma paige pamela paola patricia patrick patti patty
paul paula paulette paulina pauline pedro peggy penelope percy perla perry peter petra
philip phillip phoebe phyllis pierre pilar polly porter pradeep pramod preeti priscilla
priya priyanka quentin quincy rachael rachel rae rafael raheem rahul raj rajeev rajesh ralph
ramiro ramon ramona randall randolph raphael raquel rashad rashida raul raven ravi raymond
raymundo reba rebecca rebekah regina reginald rena renata renee reuben reyna rhonda ricardo
richard rick rickey ricky rigoberto rita robert roberta roberto robin robyn rocio rodney
rodolfo rodrigo rogelio roger rohan rohit roland rolando roman romeo ronald ronda ronnie
roosevelt rosa rosalie rosalind rosalinda rosanna rosaria rosario roseann rosemarie rosemary
rosendo rosetta rosie roslyn rowan roxana roxanne ruben rubin rudolph rudy rufus russell
ruth ruthie ryan ryder sabrina sadie salvador salvatore sam samantha samir samuel sandeep
sandra sandy sanjay santiago santos sara sarah saul saverio scarlett scott sean sebastian
selena selina selma serena sergio seth shane shanice shanna shannon shari sharon shaun shauna
shawn sheila shelby shelia shelley shelly sheree sheri sherri sherry sheryl shirley shreya
sidney siena sierra silvia simon simone sofia soledad solomon sonia sonja sonya sophia
sophie stacey stacie stacy stanley stefan stefanie stella stephan stephanie stephen sterling
steve steven stuart sue sunil susan susana susanna susie suzanne suzette svetlana sybil sylvia
tabitha tamara tameka tami tammy tania tanisha tanya tara taryn tasha tatiana teddy teresa
teri terrance terrell terrence terri terrence tessa thaddeus thelma theodore theresa thomas
tiana tiara tierra tiffany tina tisha tobias toby todd tomas tommie tommy toni tonya
tracey traci tracie tracy travis trent trevor tricia trisha tristan troy trudy tyrone tyson
ulysses uma ursula valarie valentina valeria valerie vanessa vaughn velma venessa vera
verna vernon veronica vicente vickie vicky victor victoria vikram vilma vince vincent viola
virgil virgilio vivian viviana vladimir wallace walter wanda warren wendell wendy werner
wesley whitney wilbur wilfredo wilhelmina willard willie willis wilma wilson winifred winston
xavier xiomara yadira yahir yara yasmin yesenia yolanda yousef yuki yvette yvonne zachary
zachery zahra zaid zainab zane zara zachariah zeke zelda zoe zoey zoila
`;

const CONTEXT = `
abbey ace alta amherst angel april art asia aspen august augusta austin autumn avery
banks baron bay bear berkeley bill birdie blake blaze blue bo bobby bond bonita boone
brandy brent brook brooke brooks bruce bud buddy buck cade calla camden candy canyon
carolina carson cash cassia cedar central chance chandler charity charlotte chase chelsea
cherokee cherry cheyenne chip christian city clay clayton cliff clifton clinton coco colt
colton cooper coral cornell cove creek crimson cruz cyrus daisy dakota dale dallas dane
dawn dayton dean deb dell delmar demun denver dick dixie dodge don dot drew duke dune
earl east easton eden egypt enright euclid fable faith fern field fisher flint florence
ford forest forsyth fox france frank franklin gay gene genesis georgia ginger glen glenn
grace grand grant gray green grey griffin gunner guy hamilton hanley harmony harvard hawk
hayden hazel heath heaven hill holland holly honor hope houston hudson hunter india indigo
iris ireland ivory ivy jackson jade jasper jefferson jersey jet jewel journey joy jubilee
judge june justice kelvin kennedy kent kenya king kingsbury kingston lady lake lane
laurel leaf leland liberty lincoln lindell london loop louis love luck madison mac maine major
manchester march marsh mason maverick max may meadow melody memphis mercy meramec merit
mesa milan milton misty monet montana montgomery moon moss nash nevada nile noble north
ocean olive opal orange orchid orion oxford pace page paris park parker pearl penny
pershing phoenix pine poppy prairie preston prince princeton quill quinn rain randy ray
rebel reed reef regal reid remedy rex rich ridge ridley rio river robin rock rocky rome
rose rowan royal ruby rye sage sailor salem sawyer scout shaw shepherd sherman shore
sierra skinker sky skye slate snow sonnet soulard south sparrow spencer spring star sterling
stone storm summer sunday sunny swan sydney taylor tempest tennessee texas thorn tower
trinity true tucker tulip tyler urban vale valley van vandeventer vermont violet virginia wade
ward warson washington waterman wayne webster west westminster wilder willow wilson windsor
winter wolf wood worth wren wydown yale york
`;

const toSet = (blob) => new Set(blob.trim().split(/\s+/).filter(Boolean));

export const CONTEXT_NAMES = toSet(CONTEXT);

// A name listed in both buckets resolves to CONTEXT: the ambiguous reading wins,
// so the lists can be edited independently without anyone auditing the overlap.
export const CLEAR_NAMES = new Set(
  [...toSet(CLEAR)].filter((n) => !CONTEXT_NAMES.has(n))
);
