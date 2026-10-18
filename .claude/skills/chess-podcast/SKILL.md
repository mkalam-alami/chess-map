---
name: chess-podcast
description: Skill de rédaction de podcast. Rédige un script de podcast audio (lu par un TTS) pour réviser un répertoire d'ouvertures à partir d'un fichier .chessmap.json exporté par Chess Map. Utiliser quand l'utilisateur demande un podcast, un épisode audio ou un script de révision de ses ouvertures.
---

# Skill de rédaction de podcast

Produire un script en français, destiné à être lu par le TTS de l'appli Claude à un auditeur débutant qui n'a pas d'échiquier sous les yeux.

## Source

- Lire le fichier `.chessmap.json` fourni (`map.nodes`, arbre depuis `rootId`). Chaque nœud a des coups SAN (`moves`), éventuellement une `note` (idées, évaluations, plans) et des `shapes` (flèches/cercles : menaces, plans, fautes).
- Les notes et les flèches sont la matière pédagogique principale ; vérifier la légalité et l'effet réel de chaque coup avant de le commenter (voir *Vérification*).

## Vérification

Ne jamais commenter une ligne sans l'avoir rejouée, en particulier celles qui ne sont pas dans l'arbre (prolongements, pièges, contre-exemples). Le script `scripts/chess.mjs` (chess.js du projet, `npm install` à la racine au besoin) évite de réécrire ces contrôles :

```bash
S=.claude/skills/chess-podcast/scripts/chess.mjs
node $S tree carte.chessmap.json            # arbre lisible : [id court], coups numérotés, notes, flèches et cercles (« après <coup> »)
node $S line --map carte.chessmap.json --node fc2c2fae   # ligne de la racine à un nœud (--played n pour s'arrêter dans son segment)
node $S line "1. e4 e6 2. d4 d5 3. Nc3 dxe4"            # ou une ligne libre en SAN (numéros acceptés)
node $S piece f6 e4 e6 d4 d5 Nc3 dxe4 Nxe4 Nf6 Nxf6+ Qxf6 Nf3 Bd6 Bd3 O-O Bg5   # fuites de la pièce en F_6
```

- `line` s'arrête avec `ILLÉGAL : demi-coup n …` au premier coup illégal. Pour chaque demi-coup il donne la notation TTS (« Cavalier prend F_6, échec », « E prend D_5 », « Cavalier G_8 en F_6 ») puis les faits : pièce prise, nouvelles attaques (y compris « à la découverte ») avec le nombre de défenseurs, clouages créés, et les pièces du camp qui vient de jouer restées en prise (menace ignorée ou persistante, gambit, gaffe).
- `piece <case>` liste chaque coup légal de la pièce avec les attaquants et défenseurs de la case d'arrivée : sert à affirmer qu'une pièce est piégée ou qu'une fuite est sûre.
- Limites : ce sont des comptes d'attaquants, pas des calculs d'échanges ni des évaluations (pas de moteur). Les jugements (« position égale », « gain de temps ») viennent des notes du répertoire ou de l'analyse, jamais du script.

## Contenu

- **Un seul thème par épisode**, transversal au répertoire (ex. « la dame sortie trop tôt », « pousser d4 dans les Trois Cavaliers », « clouages et découvertes sur la colonne e »). Pas d'exhaustivité, pas de fidélité à 100 % à l'arbre : choisir 3 ou 4 positions qui illustrent le thème, et des contre-exemples (le même principe vu de l'autre côté).
- Pas d'introduction, de « bienvenue », de transition décorative ni d'outro : uniquement du contenu pédagogique. Pas d'interpellation de l'auditeur (« prenez le temps de visualiser », « à vous de trouver »…).
- Conclure le thème par une règle courte et mémorisable, pas par un résumé des coups.

## Choix des lignes

- Les lignes montrées doivent être réellement rencontrées au niveau de l'auditeur (souvent bas Elo en ligne), qu'elles soient dans le répertoire ou non. Écarter les coups rares choisis pour leur seul pittoresque : 2. Fou c4 contre la française (environ 4 % des parties Lichess) n'est pas un bon exemple.
- Exception : une ligne moins jouée est permise quand elle a une vraie valeur pédagogique, et cette valeur est dite dans le commentaire. Par exemple un risque tactique ou un piège (le coup naturel qui perd), une erreur typique à éviter, ou un prolongement qui rend visible la situation stratégique (le plan de jeu, la structure de pions, la pièce qui manque à la défense).
- Les fréquences à bas Elo diffèrent de celles des maîtres. Contre 1. d4 d5, 2. Ff4 (London), 2. Cf3 et 2. e3 y sont très joués, 2. c4 bien moins ; contre la française, 3. e5 et 3. exd5 sont fréquents, et 2. Cf3, 2. d3, 2. De2, 3. Cd2 ou 3. Fd3 sont des écarts courants ; 1. Cf3 et 1. c4 transposent souvent. La connaissance générale donne un ordre de grandeur, pas des chiffres : ne jamais citer un pourcentage non vérifié, et ne pas trancher entre deux coups proches sans données.
- Pour vérifier, l'explorateur Lichess : `curl -s "https://explorer.lichess.ovh/lichess?play=e2e4,e7e6&ratings=1000,1200&speeds=blitz,rapid"` (coups en UCI, `moves[]` avec `white`, `draws`, `black`). Une requête par position étudiée, jamais de boucle sur l'arbre. Le domaine peut être bloqué par la politique réseau de l'environnement (ou demander un token) : le dire, et signaler que le choix repose sur la connaissance générale.

## Découpage en parties

- **Un message = une partie = un seul grand exemple exploré** (une position, de la position de départ jusqu'à son bilan). Annoncer le nombre total de parties dès le premier message et s'y tenir.
- Chaque partie s'écoute **indépendamment** : nommer l'ouverture et le thème au début, ne jamais renvoyer à une autre partie (« dernier exemple », « comme on l'a vu », « dans la partie suivante »…), et lier son bilan au thème.
- Ne produire qu'une partie par réponse ; la suivante vient quand l'utilisateur la demande (« suite », « continue »…).
- Une partie qui n'est pas la dernière se termine par une ligne seule `(partie 1 sur 3)` (numéro et total réels). La dernière partie se termine par la règle du thème puis uniquement par une ligne `(fin)`.

## Présentation de chaque position

- Repartir **à chaque fois de la position initiale** : « La Scandinave. Thème : la dame sortie trop tôt. Position de départ. » puis toute la séquence depuis le premier coup.
- Annoncer chaque coup par son numéro en toutes lettres : « Premier coup. », « Deuxième coup. »…
- **À partir du deuxième coup, chaque demi-coup est suivi d'un court commentaire** sur son effet concret : défense, menace, pièce capturée, clouage, gain de temps, case libérée, roque empêché…
- Quand un camp **ignore une menace**, le dire et expliquer pourquoi (contre-attaque, menace plus forte, échange forcé). Ex. : un fou qui prend un cavalier en attaquant à son tour la dame adverse, alors que sa propre dame est attaquée.
- Quand une menace **persiste** après une reprise (la pièce est toujours attaquée), le rappeler.
- Une phrase de bilan à la fin de la position, liée au thème.

## Syntaxe pour le TTS

- Texte brut uniquement : pas de titres, puces, gras, crochets, `---` ni didascalies (`[pause]` est lu à voix haute).
- Cases : lettre majuscule, underscore, chiffre : `E_4`, `D_5`, `H_1`.
- Pièces en toutes lettres : roi, dame, tour, fou, cavalier. Captures : « Dame prend D_5 ». Prise de pion : lettre de colonne seule, « E prend D_5 ». Roques : « petit roque », « grand roque ». Échec : « échec », mat : « mat ».
- Pauses : des lignes ne contenant que `…`, séparées par des lignes vides.
  - Une ligne `…` entre le coup blanc (et son commentaire) et le coup noir.
  - Trois lignes `…` après chaque coup complet et après l'annonce « Position de départ ».
- Ne rien ajouter avant ni après le script dans la réponse quand l'utilisateur demande juste le texte.

## Exemple de référence

```text
La Scandinave. Thème : la dame sortie trop tôt. Position de départ.

…

…

…

Premier coup. E_4… D_5.

…

…

…

Deuxième coup. E prend D_5. Le pion blanc capture le pion central noir.

…

Dame prend D_5. La dame reprend le pion. Le matériel est égal, mais la dame est sortie.

…

…

…

Troisième coup. Cavalier C_3. Le cavalier se développe et attaque la dame.

…

Dame A_5. La dame fuit sur le bord.

…

…

…

Quatrième coup. D_4. Le pion prend le centre. Mais la case D_2 se libère : le cavalier C_3 est maintenant cloué sur le roi par la dame A_5.

…

Cavalier F_6. Le cavalier se développe et contrôle les cases E_4 et D_5.

…

…

…

Cinquième coup. Fou D_2. Le fou s'interpose et défait le clouage du cavalier.

…

Fou G_4. Le fou se développe et attaque la dame D_1.

…

…

…

Sixième coup. Cavalier F_3. Le cavalier bloque le fou et protège la dame. Mais il est à son tour cloué sur la dame.

…

Dame F_5. La dame bascule à l'aile roi et attaque le cavalier cloué une deuxième fois.

…

…

…

Septième coup. Fou D_3. Le fou se développe avec gain de temps : il attaque la dame.

…

Fou prend F_3. Les noirs ignorent la menace sur leur dame : en capturant le cavalier, le fou attaque à son tour la dame blanche en D_1. Les blancs doivent d'abord répondre à cette menace.

…

…

…

Huitième coup. G prend F_3. Le pion reprend le fou. L'aile roi blanche est ouverte, et la dame noire est toujours attaquée par le fou D_3.

…

Dame H_3. La dame s'échappe, contrôle la case F_1 et empêche le petit roque.

…

…

…

Neuvième coup. Cavalier E_4. Le cavalier se centralise et attaque le cavalier F_6.

…

Dame G_2. La dame attaque la tour H_1.

…

…

…

Dixième coup. Roi E_2. Le roi libère la première rangée. La dame D_1 protège maintenant la tour H_1.

…

…

…

Bilan. Les blancs ont toutes leurs pièces sorties et un centre solide. La dame noire est seule en territoire adverse, sans soutien. Une dame seule fait du bruit, mais elle ne mate pas.

(partie 2 sur 3)
```
