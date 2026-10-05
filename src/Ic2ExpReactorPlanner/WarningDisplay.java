/*
 * To change this license header, choose License Headers in Project Properties.
 * To change this template file, choose Tools | Templates
 * and open the template in the editor.
 */
package Ic2ExpReactorPlanner;

import javax.swing.JOptionPane;

/**
 * Where {@link Reactor}'s user-facing parse warnings are delivered.
 *
 * <p>Why this exists: {@code setCode} has to tell the user that a pasted code could not be
 * read, and until now it called {@link JOptionPane} directly from inside the model. That made
 * every warning path untestable without a display, so the code-workspace corpus has to reach
 * {@code handleTaloniusCode} by reflection to dodge a {@link java.awt.HeadlessException}. The
 * dialog call is now a pluggable sink, so tests can capture warnings instead.
 *
 * <p>This is process-wide mutable state, which is normally a smell, and it is worth being honest
 * about why it is acceptable here. Showing a modal dialog is a genuinely global concern: there
 * is no reactor instance to hang it off, the alternative would be threading a sink through
 * every one of {@code setCode}'s public callers in the frame, and no caller ever reads the
 * result. It is {@code volatile} because it is written on the event thread and read from
 * whatever thread parses a code. It is not used anywhere in the simulation hot path.
 *
 * @see Reactor#setCode(String)
 */
public final class WarningDisplay {

    private WarningDisplay() {
        // no-op constructor to prevent instantiation.
    }

    /** Receives a warning that a user would otherwise see in a dialog. */
    public interface Sink {
        /**
         * @param title the dialog title, already localised
         * @param message the already-formatted, localised message body
         */
        void warn(String title, String message);
    }

    private static final Sink DIALOG = new Sink() {
        @Override
        public void warn(String title, String message) {
            JOptionPane.showMessageDialog(null, message, title, JOptionPane.WARNING_MESSAGE);
        }
    };

    private static volatile Sink sink = DIALOG;

    /**
     * Redirects warnings. Passing {@code null} restores the dialog, so a test that fails
     * half-way cannot leave warnings silently discarded for the rest of the JVM's life.
     */
    public static void setSink(Sink newSink) {
        sink = (newSink == null) ? DIALOG : newSink;
    }

    /** Delivers a warning through the current sink. */
    public static void warn(final String title, final String message) {
        sink.warn(title, message);
    }
}
