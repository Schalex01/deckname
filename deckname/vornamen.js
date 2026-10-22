// Häufige Vornamen im deutschsprachigen Raum (alle Generationen, plus gängige internationale Namen).
// Absichtlich eine Liste, kein Modell: erklärbar, offline, deterministisch.
// Ausschluss: Wörter, die auch Produktnamen oder häufige Nomen sind.

const LISTE = `
Aaron Abdul Abigail Achim Ada Adam Adele Adrian Adriana Agnes Ahmed Aileen Alan Albert Alena Alessandro Alex Alexa Alexander Alexandra Alfred Ali Alice Alina Alisa Alma Alois Amalia Amelie Amina Amir Amy Anastasia Andrea Andreas André Angela Angelika Anika Anita Anja Anke Ann Anna Annabell Anne Annegret Anneliese Annette Anni Annika Anton Antonia Antonio Arda Ariane Arne Arnold Arthur Artur Astrid Aurelia Axel Ayla Aylin Ayse
Barbara Bastian Bea Beate Beatrice Ben Benedikt Benjamin Benno Bernd Bernhard Bert Berta Bettina Bianca Birgit Birte Björn Bodo Boris Brigitte Bruno Burkhard
Cansu Carina Carl Carla Carlo Carlos Carmen Carolin Carolina Caroline Carsten Cedric Celina Charlotte Chiara Chris Christa Christian Christiane Christina Christine Christoph Christopher Clara Claudia Claus Clemens Colin Constantin Cora Corinna Cornelia
Dagmar Damian Dana Daniel Daniela Danny Dario David Dean Denise Dennis Detlef Diana Dieter Dietmar Dietrich Dilara Dirk Dominik Dora Doris Dorothea Dustin
Eberhard Eckhard Edgar Edith Eduard Edwin Egon Ehsan Eileen Elena Eleni Eleonore Elias Elif Elisa Elisabeth Elke Ella Ellen Elli Elmar Elsa Elvira Emil Emilia Emily Emma Emre Enno Enrico Erich Erik Erika Erna Ernst Erwin Esra Esther Eugen Eva Evelyn
Fabian Fabio Falk Fatima Fatma Felicitas Felix Ferdinand Fiona Florian Frank Franka Franz Franziska Frauke Freya Frida Frieda Friedhelm Friedrich Fritz
Gabriel Gabriele Georg George Gerald Gerd Gerhard Gerlinde Gernot Gert Gertrud Gisela Giulia Gordon Greta Gregor Gudrun Guido Gunnar Gunther Günter Günther Gustav
Hanna Hannah Hannelore Hannes Hans Harald Hartmut Hasan Hassan Hauke Hedwig Heidi Heike Heiko Heiner Heinrich Heinz Helen Helena Helene Helga Helmut Hendrik Henning Henri Henrik Henry Herbert Hermann Herta Hilde Hildegard Holger Horst Hubert Hugo
Ida Ilka Ilona Ilse Ina Ines Inga Ingo Ingrid Irene Iris Irmgard Isabel Isabell Isabella Isabelle Iva Ivan Ivo
Jack Jakob Jan Jana Janik Janina Janine Jannik Jannis Jaqueline Jasmin Jason Jean Jelena Jennifer Jenny Jens Jeremy Jessica Jil Jim Jo Joachim Joana Joel Johann Johanna Johannes John Jolina Jonas Jonathan Jörg Jörn Josef Joseph Josephine Judith Jule Julia Julian Juliana Julie Juliane Julius Jürgen Justin Justus Jutta
Kai Karen Karin Karl Karla Karolina Karoline Karsten Katharina Kathrin Katja Katrin Kerstin Kevin Kian Kilian Kim Kira Klara Klaus Konrad Konstantin Kristin Kristina Kurt
Lara Larissa Lars Laura Laurin Lea Leah Leander Lena Lene Leni Lennart Lennox Leo Leon Leona Leonard Leonhard Leonie Leopold Levi Lia Liam Lilli Lilly Lina Linda Linus Lisa Liv Lorenz Lotta Lotte Louis Louisa Louise Luca Lucas Lucia Ludwig Luis Luisa Luise Lukas Luna Lutz Lydia
Magdalena Maik Maike Malte Manfred Manuel Manuela Mara Marc Marcel Marco Marcus Mareike Maren Margarete Margit Margot Maria Marianne Marie Marina Mario Marion Marius Marko Markus Marlene Marlon Marta Martha Martin Martina Marvin Mathias Mats Matthias Maurice Max Maximilian Maya Mehmet Melanie Melina Melissa Merle Meryem Mia Michael Michaela Michel Michelle Mika Mila Milan Milena Mina Mira Miriam Mohamed Mohammed Mona Monika Moritz Murat Mustafa
Nadine Nadja Nancy Naomi Natalie Nathalie Nele Nelly Nico Nicolas Nicole Niklas Niko Nils Nina Noah Nora Norbert Norman
Olaf Ole Olga Oliver Olivia Omar Oskar Oswald Otto
Pascal Patricia Patrick Paul Paula Pauline Peter Petra Philip Philipp Philippa Pia Pierre Piet
Rafael Rainer Ralf Ralph Ramona Raphael Rebecca Regina Reinhard Reiner Renate René Ricarda Richard Rita Robert Robin Roland Rolf Roman Romy Ronald Ronja Rosa Rosemarie Roswitha Rudolf Rüdiger Ruth Ryan
Sabine Sabrina Said Sally Salome Sam Samantha Samira Samuel Sandra Sandro Sara Sarah Sascha Saskia Sebastian Selin Selina Selma Sergej Sibylle Siegfried Sigrid Silke Silvia Simon Simone Sina Sofia Sofie Sonja Sophia Sophie Stefan Stefanie Steffen Steffi Stephan Stephanie Sven Svenja Sybille Sylvia
Tamara Tanja Tara Tarek Teresa Theo Theodor Theresa Thilo Thomas Thorsten Tiago Til Till Tilo Tim Timo Timon Tina Tobias Tom Toni Tony Torben Torsten Tugce Tuğçe
Udo Ulf Ulla Ulrich Ulrike Ursula Uta Ute Uwe
Valentin Valentina Valerie Vanessa Vedad Vera Verena Veronika Victoria Viktor Viktoria Vincent Viola Volker
Waldemar Walter Waltraud Werner Wilfried Wilhelm Willi Wolfgang
Xenia Yannick Yannik Yasemin Yasmin Yusuf Yvonne
Zeynep Zoe Zoé
`;

export const VORNAMEN = new Set(LISTE.split(/\s+/).filter(Boolean));

// Kein Treffer, auch wenn es wie ein Vorname aussieht: Produktnamen und Wörter mit Doppelbedeutung.
export const VORNAMEN_AUSSCHLUSS = new Set([
  "Claude", "Alexa", "Siri", "Gemini", "Copilot", "Ernst", "August", "Mai", "Sonne",
]);

// Kurz- und Doppeldeutigkeits-Namen: nur zusammen mit einem Nachnamen ein Treffer
// („Max" allein nicht, „Max Berger" schon). Eigene Wörterbucheinträge schlagen die Liste immer.
export const VORNAMEN_KURZ = new Set([
  "Max", "Mark", "Bill", "Frank", "Rose", "Sam", "Jo", "Bea", "Toni", "Kim", "Tim", "Tom", "Ben", "Jan", "Ali", "Chris",
]);
